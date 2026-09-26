package storage

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func noisyImage(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x*7 ^ y*13), uint8(x * y), uint8(x + y*3), 255})
		}
	}
	return img
}

// withOrientation inserts an EXIF APP1 segment carrying orientation o.
func withOrientation(jpg []byte, o uint16) []byte {
	tiff := []byte{'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0}
	entry := make([]byte, 12)
	binary.LittleEndian.PutUint16(entry[0:], 0x0112)
	binary.LittleEndian.PutUint16(entry[2:], 3)
	binary.LittleEndian.PutUint32(entry[4:], 1)
	binary.LittleEndian.PutUint16(entry[8:], o)
	tiff = append(tiff, entry...)
	tiff = append(tiff, 0, 0, 0, 0)
	payload := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	seg = append(seg, payload...)
	out := append([]byte{}, jpg[:2]...)
	out = append(out, seg...)
	return append(out, jpg[2:]...)
}

func TestOptimizeImageDownsizesAndRotates(t *testing.T) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, noisyImage(3000, 2000), &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	src := withOrientation(buf.Bytes(), 6)
	if o := jpegOrientation(src); o != 6 {
		t.Fatalf("orientation = %d", o)
	}
	out, ok := OptimizeImage(src, "image/jpeg")
	if !ok {
		t.Fatal("expected optimization")
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	// 3000x2000 -> 1600x1066, then rotated 90° to portrait.
	if cfg.Width != 1066 || cfg.Height != 1600 {
		t.Fatalf("size = %dx%d", cfg.Width, cfg.Height)
	}
	if len(out) >= len(src) {
		t.Fatalf("not smaller: %d >= %d", len(out), len(src))
	}
}

func TestOptimizeImageKeepsSmallFiles(t *testing.T) {
	var buf bytes.Buffer
	_ = png.Encode(&buf, noisyImage(200, 100))
	if _, ok := OptimizeImage(buf.Bytes(), "image/png"); ok {
		t.Fatal("small png should be kept as is")
	}
	if _, ok := OptimizeImage([]byte("GIF89a..."), "image/gif"); ok {
		t.Fatal("gif should be skipped")
	}
}
