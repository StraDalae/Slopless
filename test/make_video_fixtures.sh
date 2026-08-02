#!/usr/bin/env bash
# Generates sample MP4s with different container-metadata profiles, so the
# video checker can be exercised without needing real phone footage or
# actual AI-generated video on hand.
#
# Requires ffmpeg. Run: bash test/make_video_fixtures.sh

set -e
DIR="$(dirname "$0")/fixtures"
mkdir -p "$DIR"

# 1. CAMERA_VERIFIED: real phone make/model tags, no AI signature
ffmpeg -f lavfi -i color=c=gray:s=320x240:d=1 \
  -metadata com.apple.quicktime.make="Apple" \
  -metadata com.apple.quicktime.model="iPhone 15 Pro" \
  -metadata com.apple.quicktime.software="17.4.1" \
  -c:v libx264 -movflags use_metadata_tags \
  -y "$DIR/camera_verified.mp4" -loglevel error

# 2. AI_SIGNATURE_DETECTED: a tag names a known AI tool
ffmpeg -f lavfi -i color=c=blue:s=320x240:d=1 \
  -metadata comment="Generated with Runway Gen-3 Alpha" \
  -c:v libx264 -movflags use_metadata_tags \
  -y "$DIR/ai_generated.mp4" -loglevel error

# 3. EDITED_UNKNOWN: has metadata (ordinary encoder tag), no camera make
ffmpeg -f lavfi -i color=c=green:s=320x240:d=1 \
  -metadata comment="Exported from Adobe Premiere Pro 25.0" \
  -c:v libx264 -movflags use_metadata_tags \
  -y "$DIR/edited_unknown.mp4" -loglevel error

# 4. Re-encoded with "copied" metadata stripped, but note: mp4/mov muxers
# still auto-write their own stream-level encoder/handler tags regardless
# of -map_metadata -1 -- that's not copied metadata, it's the muxer
# describing itself. So this file still classifies as EDITED_UNKNOWN, not
# NO_METADATA -- which is actually realistic: true zero-metadata mp4/mov is
# rarer than you'd think.
ffmpeg -f lavfi -i color=c=black:s=320x240:d=1 \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact \
  -c:v libx264 \
  -y "$DIR/reencoded_no_camera_claim.mp4" -loglevel error

# 5. NO_METADATA (genuine): a raw H.264 elementary stream has no container
# at all, so there's nowhere for any tag to live. This is the real
# "nothing to check" case.
ffmpeg -f lavfi -i color=c=purple:s=320x240:d=1 \
  -c:v libx264 -f h264 \
  -y "$DIR/truly_stripped.h264" -loglevel error

echo "Video fixtures written to $DIR"
ls "$DIR"/*.mp4 "$DIR"/*.h264
