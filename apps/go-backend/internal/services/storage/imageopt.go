package storage

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
	"image/png"
	"strings"

	"golang.org/x/image/draw"
)

const (
	// MaxImageEdge is the longest side, in pixels, kept for stored images.
	// The largest on-page rendering (product gallery at 2x DPR) fits in it.
	MaxImageEdge = 1600
	// Files at or under this size and edge are stored untouched.
	optimizeMinBytes = 350 << 10
	jpegQuality      = 82
	// Refuse to decode anything bigger (decompression-bomb guard, ~50 MP).
	maxDecodePixels = 50_000_000

	// ImmutableCacheControl is safe because image keys are unique per upload.
	ImmutableCacheControl = "public, max-age=31536000, immutable"
)

// OptimizeImage downsizes and recompresses large JPEG/PNG images so the
// storefront never has to pull multi-megabyte camera originals. It returns
// the input unchanged when it is already small, is another format, or the
// result would not be smaller.
func OptimizeImage(data []byte, contentType string) ([]byte, bool) {
	ct := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if ct != "image/jpeg" && ct != "image/png" {
		return data, false
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxDecodePixels {
		return data, false
	}
	if format != "jpeg" && format != "png" {
		return data, false
	}
	orientation := 1
	if format == "jpeg" {
		orientation = jpegOrientation(data)
	}
	if max(cfg.Width, cfg.Height) <= MaxImageEdge && len(data) <= optimizeMinBytes && orientation == 1 {
		return data, false
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, false
	}
	img := resizeToFit(src, MaxImageEdge)
	img = applyOrientation(img, orientation)

	var out bytes.Buffer
	if format == "png" {
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		err = enc.Encode(&out, img)
	} else {
		err = jpeg.Encode(&out, img, &jpeg.Options{Quality: jpegQuality})
	}
	// A rotated result must be kept even if it is not smaller, otherwise the
	// photo would show sideways once the EXIF tag is gone.
	if err != nil || (out.Len() >= len(data) && orientation == 1) {
		return data, false
	}
	return out.Bytes(), true
}

func resizeToFit(src image.Image, maxEdge int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if max(w, h) <= maxEdge {
		return src
	}
	if w >= h {
		h = max(1, h*maxEdge/w)
		w = maxEdge
	} else {
		w = max(1, w*maxEdge/h)
		h = maxEdge
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst
}

// applyOrientation bakes an EXIF orientation (2–8) into the pixels.
func applyOrientation(src image.Image, orientation int) image.Image {
	if orientation < 2 || orientation > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	swap := orientation >= 5
	dw, dh := w, h
	if swap {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var dx, dy int
			switch orientation {
			case 2: // mirror horizontal
				dx, dy = w-1-x, y
			case 3: // rotate 180
				dx, dy = w-1-x, h-1-y
			case 4: // mirror vertical
				dx, dy = x, h-1-y
			case 5: // transpose
				dx, dy = y, x
			case 6: // rotate 90 CW
				dx, dy = h-1-y, x
			case 7: // transverse
				dx, dy = h-1-y, w-1-x
			case 8: // rotate 90 CCW
				dx, dy = y, w-1-x
			}
			dst.Set(dx, dy, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

// jpegOrientation reads the EXIF orientation tag (1 when absent/unreadable).
func jpegOrientation(data []byte) int {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return 1
	}
	i := 2
	for i+4 <= len(data) {
		if data[i] != 0xFF {
			return 1
		}
		marker := data[i+1]
		if marker == 0xDA || marker == 0xD9 { // start of scan / end of image
			return 1
		}
		segLen := int(binary.BigEndian.Uint16(data[i+2 : i+4]))
		if segLen < 2 || i+2+segLen > len(data) {
			return 1
		}
		seg := data[i+4 : i+2+segLen]
		if marker == 0xE1 && len(seg) > 14 && string(seg[:6]) == "Exif\x00\x00" {
			return exifOrientation(seg[6:])
		}
		i += 2 + segLen
	}
	return 1
}

func exifOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var bo binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	ifd := int(bo.Uint32(tiff[4:8]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 1
	}
	n := int(bo.Uint16(tiff[ifd : ifd+2]))
	for k := 0; k < n; k++ {
		e := ifd + 2 + k*12
		if e+12 > len(tiff) {
			return 1
		}
		if bo.Uint16(tiff[e:e+2]) == 0x0112 {
			if v := int(bo.Uint16(tiff[e+8 : e+10])); v >= 1 && v <= 8 {
				return v
			}
			return 1
		}
	}
	return 1
}
