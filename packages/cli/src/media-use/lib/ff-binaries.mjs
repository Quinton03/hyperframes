// The binaries media-use spawns: HYPERFRAMES_FFMPEG_PATH / HYPERFRAMES_FFPROBE_PATH when set, else PATH.
export const ffmpegBinary = () => process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || "ffmpeg";
export const ffprobeBinary = () => process.env.HYPERFRAMES_FFPROBE_PATH?.trim() || "ffprobe";
