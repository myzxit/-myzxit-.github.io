// 화면 공유 캡처 + 변화 감지

const THUMB = 40; // 변화 감지용 축소 크기

export class ScreenCapture {
  /**
   * @param {HTMLVideoElement} video 미리보기
   * @param {HTMLCanvasElement} work  전송용 프레임 캔버스
   * @param {HTMLCanvasElement} thumb 변화 감지용 축소 캔버스
   */
  constructor(video, work, thumb) {
    this.video = video;
    this.work = work;
    this.thumb = thumb;
    this.workCtx = work.getContext('2d', { willReadFrequently: true });
    this.thumbCtx = thumb.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.crop = null;      // {x, y, w, h} — 영상 원본 픽셀 기준
    this.onEnded = () => {};
  }

  get active() {
    return !!this.stream;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 5, max: 15 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.stream.getVideoTracks()[0].addEventListener('ended', () => {
      this.stop();
      this.onEnded();
    });
    // 첫 프레임 크기가 잡힐 때까지 잠깐 기다립니다.
    if (!this.video.videoWidth) {
      await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.crop = null;
  }

  /** 지정 영역(없으면 전체)의 소스 사각형 */
  sourceRect() {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!this.crop) return { x: 0, y: 0, w, h };
    const c = this.crop;
    return {
      x: Math.max(0, Math.min(c.x, w - 1)),
      y: Math.max(0, Math.min(c.y, h - 1)),
      w: Math.max(1, Math.min(c.w, w - c.x)),
      h: Math.max(1, Math.min(c.h, h - c.y)),
    };
  }

  /** 현재 프레임을 JPEG data URL로 캡처합니다. */
  grab(maxWidth = 1400, quality = 0.72) {
    if (!this.active || !this.video.videoWidth) return null;
    const r = this.sourceRect();
    const scale = Math.min(1, maxWidth / r.w);
    this.work.width = Math.max(1, Math.round(r.w * scale));
    this.work.height = Math.max(1, Math.round(r.h * scale));
    this.workCtx.drawImage(this.video, r.x, r.y, r.w, r.h, 0, 0, this.work.width, this.work.height);
    return this.work.toDataURL('image/jpeg', quality);
  }

  /** 변화 감지용 축소 그레이스케일 시그니처 */
  signature() {
    if (!this.active || !this.video.videoWidth) return null;
    const r = this.sourceRect();
    this.thumbCtx.drawImage(this.video, r.x, r.y, r.w, r.h, 0, 0, THUMB, THUMB);
    const { data } = this.thumbCtx.getImageData(0, 0, THUMB, THUMB);
    const sig = new Uint8Array(THUMB * THUMB);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      sig[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    return sig;
  }
}

/** 두 시그니처의 평균 차이를 0~100 으로 반환 */
export function diffPercent(a, b) {
  if (!a || !b || a.length !== b.length) return 100;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return (sum / a.length / 255) * 100;
}

/** data URL → { mime, base64 } */
export function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}
