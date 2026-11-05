#!/bin/sh
# Turn a folder of greeting recordings into game-ready audio/<country>.mp3 files.
#
#   tools/prepare-audio.sh ~/Desktop/recordings
#
# Each recording can be m4a (Voice Memos), mp3, wav or aiff, and must be named after
# its country id in countries.js, for example japan.m4a or south-korea.wav.
# The script trims silence from both ends (the countdown starts the moment the
# greeting ends), evens out the loudness, adds 0.15 s of lead-in so a Bluetooth
# speaker waking up doesn't swallow the first syllable, and saves 128 kbps mono MP3.
set -eu

src=${1:?Give the folder that holds the recordings}
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/audio"
known=$(sed -n "s/.*id: '\([a-z-]*\)'.*/\1/p" "$root/countries.js")
PATH="/opt/homebrew/bin:$PATH"

for file in "$src"/*; do
  [ -f "$file" ] || continue
  name=$(basename "$file")
  name=$(printf '%s' "${name%.*}" | tr 'A-Z _' 'a-z--')
  if ! printf '%s\n' "$known" | grep -qx "$name"; then
    echo "SKIPPED $file: not a country id in countries.js"
    continue
  fi
  ffmpeg -nostdin -loglevel error -y -i "$file" -af \
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,loudnorm=I=-16:TP=-1.5:LRA=11,adelay=150:all=1,apad=pad_dur=0.1,asetpts=N/SR/TB" \
    -ac 1 -ar 44100 -b:a 128k "$out/$name.mp3"
  seconds=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/$name.mp3")
  echo "OK      audio/$name.mp3 (${seconds}s)"
done
