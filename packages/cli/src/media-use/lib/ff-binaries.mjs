import { accessSync, constants } from "node:fs";

// The binaries media-use spawns: HYPERFRAMES_FFMPEG_PATH / HYPERFRAMES_FFPROBE_PATH when set, else PATH.
// A set path that cannot run throws, so a broken override never reads as "no metadata".
function configuredOr(name, envVar) {
  const path = process.env[envVar]?.trim();
  if (!path) return name;
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new Error(`${envVar} names "${path}", which cannot run: fix it or unset it.`);
  }
  return path;
}

export const ffmpegBinary = () => configuredOr("ffmpeg", "HYPERFRAMES_FFMPEG_PATH");
export const ffprobeBinary = () => configuredOr("ffprobe", "HYPERFRAMES_FFPROBE_PATH");
