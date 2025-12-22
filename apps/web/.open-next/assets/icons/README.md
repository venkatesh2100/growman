# PWA Icons

This directory should contain PWA icons for the application.

## Required Icons

Generate the following icon sizes from a 512x512 source image:

- `icon-72x72.png` (72x72)
- `icon-96x96.png` (96x96)
- `icon-128x128.png` (128x128)
- `icon-144x144.png` (144x144)
- `icon-152x152.png` (152x152)
- `icon-192x192.png` (192x192)
- `icon-384x384.png` (384x384)
- `icon-512x512.png` (512x512)

## Generating Icons

You can use online tools like:
- https://realfavicongenerator.net/
- https://www.pwabuilder.com/imageGenerator
- https://favicon.io/favicon-generator/

Or use ImageMagick/GraphicsMagick:

```bash
# Create icons directory
mkdir -p public/icons

# Generate icons from a 512x512 source image (source.png)
convert source.png -resize 72x72 public/icons/icon-72x72.png
convert source.png -resize 96x96 public/icons/icon-96x96.png
convert source.png -resize 128x128 public/icons/icon-128x128.png
convert source.png -resize 144x144 public/icons/icon-144x144.png
convert source.png -resize 152x152 public/icons/icon-152x152.png
convert source.png -resize 192x192 public/icons/icon-192x192.png
convert source.png -resize 384x384 public/icons/icon-384x384.png
cp source.png public/icons/icon-512x512.png
```

## Icon Design Guidelines

- Use a simple, recognizable design
- Ensure icons are readable at small sizes
- Use high contrast colors
- Icons should work on both light and dark backgrounds
- Consider using the app's primary color (emerald/green) as the background

