"""
Generates sample JPEGs with different EXIF profiles so we can exercise every
branch of the metadata checker without needing real camera footage or actual
AI-generated files on hand.

Run: python3 test/make_fixtures.py
"""
import os
import piexif
from PIL import Image

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(FIXTURES_DIR, exist_ok=True)


def make_blank_jpeg(path):
    img = Image.new("RGB", (640, 360), color=(40, 40, 40))
    img.save(path, "jpeg")


def write_exif(path, ifd_data):
    exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": None}
    exif_dict.update(ifd_data)
    exif_bytes = piexif.dump(exif_dict)
    piexif.insert(exif_bytes, path)


# 1. CAMERA_VERIFIED: real phone camera make/model, no AI signature
p = os.path.join(FIXTURES_DIR, "camera_verified.jpg")
make_blank_jpeg(p)
write_exif(p, {
    "0th": {
        piexif.ImageIFD.Make: "Apple",
        piexif.ImageIFD.Model: "iPhone 15 Pro",
        piexif.ImageIFD.Software: "17.4.1",
    }
})

# 2. AI_SIGNATURE_DETECTED: software tag names a known AI tool
p = os.path.join(FIXTURES_DIR, "ai_generated.jpg")
make_blank_jpeg(p)
write_exif(p, {
    "0th": {
        piexif.ImageIFD.Software: "Runway Gen-3 Alpha",
    }
})

# 3. EDITED_UNKNOWN: metadata present, ordinary editing software, no camera make
p = os.path.join(FIXTURES_DIR, "edited_unknown.jpg")
make_blank_jpeg(p)
write_exif(p, {
    "0th": {
        piexif.ImageIFD.Software: "Adobe Photoshop 25.0",
    }
})

# 4. NO_METADATA: totally blank, no EXIF at all
p = os.path.join(FIXTURES_DIR, "no_metadata.jpg")
make_blank_jpeg(p)  # no write_exif call -- stays metadata-free

print("Fixtures written to", FIXTURES_DIR)
for f in sorted(os.listdir(FIXTURES_DIR)):
    print(" -", f)
