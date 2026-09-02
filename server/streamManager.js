const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const STREAMS_DIR = path.join(__dirname, '..', 'streams');
const IDLE_TIMEOUT_MS = 60 * 1000; // matikan stream jika tidak diakses 60 detik
const GC_INTERVAL_MS = 15 * 1000;

// Map<cameraId, { process, lastAccess, dir }>
const activeStreams = new Map();

function buildRtspUrl(camera) {
  const { ip, port, username, password, rtsp_path } = camera;
  const user = encodeURIComponent(username);
  const pass = encodeURIComponent(password);
  const cleanPath = rtsp_path.startsWith('/') ? rtsp_path : `/${rtsp_path}`;
  return `rtsp://${user}:${pass}@${ip}:${port || 554}${cleanPath}`;
}

function startStream(camera) {
  const id = String(camera.id);
  const existing = activeStreams.get(id);

  if (existing) {
    existing.lastAccess = Date.now();
    return { playlist: `/streams/cam_${id}/index.m3u8`, alreadyRunning: true };
  }

  const dir = path.join(STREAMS_DIR, `cam_${id}`);
  fs.mkdirSync(dir, { recursive: true });

  const rtspUrl = buildRtspUrl(camera);
  const playlistPath = path.join(dir, 'index.m3u8');

  const args = [
    '-rtsp_transport', 'tcp',
    '-timeout', '5000000',
    '-i', rtspUrl,
    '-c:v', 'copy',
    '-c:a', 'aac', '-ac', '1', '-b:a', '32k',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '4',
    '-hls_flags', 'delete_segments+omit_endlist',
    playlistPath
  ];

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stderr.on('data', (chunk) => {
    // Uncomment untuk debug per-kamera:
    // console.log(`[cam ${id}] ${chunk.toString()}`);
  });

  proc.on('exit', (code) => {
    console.log(`[cam ${id}] ffmpeg berhenti (code ${code})`);
    activeStreams.delete(id);
  });

  activeStreams.set(id, { process: proc, lastAccess: Date.now(), dir });

  return { playlist: `/streams/cam_${id}/index.m3u8`, alreadyRunning: false };
}

function touchStream(cameraId) {
  const existing = activeStreams.get(String(cameraId));
  if (existing) existing.lastAccess = Date.now();
}

function stopStream(cameraId) {
  const id = String(cameraId);
  const existing = activeStreams.get(id);
  if (!existing) return false;
  existing.process.kill('SIGKILL');
  activeStreams.delete(id);
  fs.rm(existing.dir, { recursive: true, force: true }, () => {});
  return true;
}

function stopAll() {
  for (const id of Array.from(activeStreams.keys())) stopStream(id);
}

// Garbage collector: matikan stream yang tidak ditonton lagi supaya hemat CPU/bandwidth
setInterval(() => {
  const now = Date.now();
  for (const [id, info] of activeStreams.entries()) {
    if (now - info.lastAccess > IDLE_TIMEOUT_MS) {
      console.log(`[cam ${id}] idle, menghentikan stream`);
      stopStream(id);
    }
  }
}, GC_INTERVAL_MS);

process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

module.exports = { startStream, stopStream, touchStream, stopAll, buildRtspUrl };
