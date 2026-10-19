package handlers

import (
	"bytes"
	"image"
	"image/jpeg"
	"testing"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/plantnet"
)

func TestNormalizePlantPhotoKeepsJPEGAndRejectsHEIC(t *testing.T) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2)), &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	got, err := normalizePlantPhoto(plantnet.Photo{Filename: "shot.webp", ContentType: "image/webp", Bytes: buf.Bytes()})
	if err != nil {
		t.Fatal(err)
	}
	if got.ContentType != "image/jpeg" || got.Filename != "shot.jpg" {
		t.Fatalf("photo = %+v", got)
	}

	heic := append([]byte("....ftypheic"), bytes.Repeat([]byte{0}, 32)...)
	copy(heic, []byte{0, 0, 0, 24})
	if _, err := normalizePlantPhoto(plantnet.Photo{Filename: "iphone.HEIC", Bytes: heic}); err == nil || !bytes.Contains([]byte(err.Error()), []byte("HEIC")) {
		t.Fatalf("heic err = %v", err)
	}
}

func TestNormalizePlantPhotoShrinksLongEdge(t *testing.T) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1700, 800)), &jpeg.Options{Quality: 70}); err != nil {
		t.Fatal(err)
	}
	got, err := normalizePlantPhoto(plantnet.Photo{Filename: "phone.jpg", Bytes: buf.Bytes()})
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(got.Bytes))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Width != 1600 || cfg.Height != 752 {
		t.Fatalf("size = %dx%d", cfg.Width, cfg.Height)
	}
}

func TestSniffImage(t *testing.T) {
	if sniffImage([]byte{0xff, 0xd8, 0xff, 0x00}) != "jpeg" {
		t.Fatal("jpeg")
	}
	webp := make([]byte, 12)
	copy(webp, []byte("RIFF"))
	copy(webp[8:], []byte("WEBP"))
	if sniffImage(webp) != "webp" {
		t.Fatal("webp")
	}
}
