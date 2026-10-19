package handlers

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"path/filepath"
	"strings"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/plantnet"
	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

// plantPhotoMaxEdge is the longest side sent to Pl@ntNet. Phone photos are
// often several thousand pixels on a side; the identification service
// rejects or times out on those even when the file itself is under the
// upload cap. 1600px is enough for a leaf or flower.
const plantPhotoMaxEdge = 1600

// normalizePlantPhoto turns a JPEG, PNG, or WebP into a baseline JPEG no
// larger than plantPhotoMaxEdge. The bytes are what we trust, not the
// filename the browser sent.
func normalizePlantPhoto(photo plantnet.Photo) (plantnet.Photo, error) {
	img, err := decodePlantPhoto(photo.Bytes)
	if err != nil {
		return photo, err
	}
	img = fitImage(img, plantPhotoMaxEdge)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		return photo, errors.New("That photo could not be read. Try a JPEG of the plant.")
	}
	photo.Bytes = buf.Bytes()
	photo.ContentType = "image/jpeg"
	photo.Filename = withExt(photo.Filename, ".jpg")
	return photo, nil
}

func decodePlantPhoto(b []byte) (image.Image, error) {
	kind := sniffImage(b)
	if kind == "jpeg" || kind == "png" || kind == "webp" {
		if tooLarge(b, kind) {
			return nil, errors.New("That photo is too large. Crop it closer and try again.")
		}
	}
	switch kind {
	case "jpeg":
		img, err := jpeg.Decode(bytes.NewReader(b))
		if err != nil {
			return nil, errors.New("That photo could not be read. Try a JPEG of the plant.")
		}
		return img, nil
	case "png":
		img, err := png.Decode(bytes.NewReader(b))
		if err != nil {
			return nil, errors.New("That photo could not be read. Try a JPEG of the plant.")
		}
		return img, nil
	case "webp":
		img, err := webp.Decode(bytes.NewReader(b))
		if err != nil {
			return nil, errors.New("That WebP photo could not be read.")
		}
		return img, nil
	case "heic":
		return nil, errors.New("This photo is HEIC. Export it as a JPEG, then scan it again.")
	default:
		return nil, errors.New("Use a JPEG, PNG, or WebP photo of one plant.")
	}
}

func tooLarge(b []byte, kind string) bool {
	var cfg image.Config
	var err error
	r := bytes.NewReader(b)
	switch kind {
	case "jpeg":
		cfg, err = jpeg.DecodeConfig(r)
	case "png":
		cfg, err = png.DecodeConfig(r)
	case "webp":
		cfg, err = webp.DecodeConfig(r)
	default:
		return false
	}
	if err != nil || cfg.Width < 1 || cfg.Height < 1 {
		return false
	}
	return cfg.Width > 8000 || cfg.Height > 8000 || cfg.Width*cfg.Height > 24_000_000
}

func fitImage(src image.Image, maxEdge int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 1 || h < 1 || maxEdge < 1 {
		return src
	}
	long := w
	if h > long {
		long = h
	}
	if long <= maxEdge {
		return src
	}
	nw := w * maxEdge / long
	nh := h * maxEdge / long
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
	return dst
}

func sniffImage(b []byte) string {
	switch {
	case len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff:
		return "jpeg"
	case len(b) >= 8 && bytes.Equal(b[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}):
		return "png"
	case len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "webp"
	case len(b) >= 12 && string(b[4:8]) == "ftyp":
		switch string(b[8:12]) {
		case "heic", "heix", "hevc", "hevx", "mif1", "msf1":
			return "heic"
		}
	}
	return ""
}

func withExt(name, ext string) string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	if base == "" {
		base = "plant"
	}
	return base + ext
}
