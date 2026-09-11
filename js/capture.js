// 입력 소스(화면 공유 · 카메라 · 사진) 캡처와 변화 감지

const THUMB = 40; // 변화 감지용 축소 크기

export const SCREEN_SUPPORTED = !!navigator.mediaDevices?.getDisplayMedia;
export const CAMERA_SUPPORTED = !!navigator.mediaDevices?.getUserMedia;


/**
 * 사진을 화면·전송에 쓰기 좋은 형태로 정리합니다. (§5)
 *
 * - EXIF 방향 보정: 폰으로 세로 촬영한 사진이 눕는 문제를 막습니다.
 *   최신 브라우저는 <img> 에 자동 적용하지만 구형 WebView 는 그렇지 않아,
 *   여기서 픽셀 자체를 바로 세워 둡니다.
 * - 지나치게 큰 사진을 미리 줄여 메모리 사용과 전송량을 낮춥니다. (§42)
 *
 * createImageBitmap 을 쓸 수 없는 환경에서는 원본을 그대로 돌려줍니다
 * (기능이 사라지는 것보다 낫습니다).
 */
export async function normalizePhoto(file, maxWidth = 2400) {
  const readAsDataUrl = () => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });

  if (typeof createImageBitmap !== 'function') return readAsDataUrl();

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);   // 옵션 미지원 브라우저
    } catch {
      return readAsDataUrl();                   // 디코딩 자체를 못 하면 원본으로
    }
  }

  try {
    const scale = Math.min(1, maxWidth / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return readAsDataUrl();
  } finally {
    // 비트맵은 GC 를 기다리지 않고 즉시 해제합니다. (§41)
    bitmap.close?.();
  }
}

export class Capture {
  /**
   * @param {HTMLVideoElement} video 화면공유·카메라 미리보기
   * @param {HTMLImageElement} still 사진 미리보기
   * @param {HTMLCanvasElement} work  전송용 프레임 캔버스
   * @param {HTMLCanvasElement} thumb 변화 감지용 축소 캔버스
   */
  constructor(video, still, work, thumb) {
    this.video = video;
    this.still = still;
    this.work = work;
    this.thumb = thumb;
    this.workCtx = work.getContext('2d', { willReadFrequently: true });
    this.thumbCtx = thumb.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.mode = 'idle';    // 'idle' | 'screen' | 'camera' | 'photo' | 'native'
    this.facing = 'environment';
    this.crop = null;      // {x, y, w, h} — 원본 픽셀 기준
    this.onEnded = () => {};
  }

  get active() {
    return this.mode !== 'idle';
  }

  /**
   * JS 쪽 자동 감지 루프를 돌려야 하는 소스인지.
   * 'native'(Android 화면 공유)는 네이티브가 이미 변화 감지를 끝내고
   * 필요한 프레임만 올려 주므로 JS 루프를 돌리지 않습니다.
   */
  get isLive() {
    return this.mode === 'screen' || this.mode === 'camera';
  }

  /** 캡처가 계속 들어오는 소스인지 (UI 의 '중지' 버튼 노출 기준) */
  get isStreaming() {
    return this.isLive || this.mode === 'native';
  }

  /** 화면에 실제로 보이는 요소 (영역 지정 좌표 계산용) */
  get displayEl() {
    return this.isLive ? this.video : this.still;
  }

  /** 현재 그릴 원본 요소와 크기 */
  source() {
    if (this.mode === 'photo' || this.mode === 'native') {
      return { el: this.still, w: this.still.naturalWidth, h: this.still.naturalHeight };
    }
    if (this.isLive) {
      return { el: this.video, w: this.video.videoWidth, h: this.video.videoHeight };
    }
    return null;
  }

  async startScreen() {
    if (!SCREEN_SUPPORTED) {
      throw new Error('이 브라우저는 화면 공유를 지원하지 않습니다. 카메라나 사진 모드를 사용하세요.');
    }
    await this.#useStream(
      await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 15 } },
        audio: false,
      }),
      'screen',
    );
  }

  async startCamera(facing = this.facing) {
    if (!CAMERA_SUPPORTED) {
      throw new Error('이 브라우저는 카메라를 지원하지 않습니다. 사진 모드를 사용하세요.');
    }
    this.facing = facing;
    // 글씨를 읽어야 하므로 가능한 한 고해상도를 요청합니다.
    const constraints = {
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // 후면 카메라가 없는 기기(노트북 등)에서는 기본 카메라로 물러섭니다.
      if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw err;
      }
    }
    await this.#useStream(stream, 'camera');
  }

  async #useStream(stream, mode) {
    this.stop();
    this.stream = stream;
    this.mode = mode;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      this.stop();
      this.onEnded();
    });
    if (!this.video.videoWidth) {
      await new Promise((resolve) => {
        this.video.addEventListener('loadedmetadata', resolve, { once: true });
      });
    }
  }

  /** 카메라 전면/후면 전환 */
  async flipCamera() {
    if (this.mode !== 'camera') return;
    await this.startCamera(this.facing === 'environment' ? 'user' : 'environment');
  }

  /**
   * 정지 이미지를 <img> 에 올리고 디코딩이 끝날 때까지 기다립니다.
   *
   * 같은 src 를 다시 대입하면 브라우저가 load 이벤트를 발생시키지 않습니다.
   * 그대로 onload 를 기다리면 영원히 멈추므로(같은 화면에서 '지금 풀기'를
   * 두 번 누르거나 같은 사진을 다시 고르는 흔한 경우) 반드시 먼저 확인합니다.
   */
  async #showStill(dataUrl, label) {
    const img = this.still;
    if (img.getAttribute('src') === dataUrl && img.complete && img.naturalWidth > 0) {
      return; // 이미 같은 이미지가 올라와 있습니다
    }
    img.src = dataUrl;
    try {
      // decode() 는 이미 디코딩이 끝난 이미지에도 즉시 resolve 합니다.
      if (img.decode) await img.decode();
      else {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error(label));
        });
      }
    } catch {
      throw new Error(label);
    }
    if (!img.naturalWidth) throw new Error(label);
  }

  /**
   * Android 네이티브가 올려 준 프레임 한 장을 소스로 설정합니다.
   * 사진과 같은 정지 이미지지만, 계속 갱신되는 스트림이라 mode 를 구분합니다.
   */
  async setNativeFrame(dataUrl) {
    await this.#showStill(dataUrl, '캡처 화면을 표시하지 못했습니다.');
    this.stopStream();
    this.mode = 'native';
  }

  /** 사진(파일/촬영) 한 장을 소스로 설정합니다. */
  async setPhoto(file, maxWidth = 2400) {
    const dataUrl = await normalizePhoto(file, maxWidth);
    await this.#showStill(dataUrl, '사진을 표시하지 못했습니다.');
    this.stopStream();
    this.mode = 'photo';
    this.crop = null;
  }

  stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  stop() {
    this.stopStream();
    this.mode = 'idle';
    this.crop = null;
  }

  /** 지정 영역(없으면 전체)의 소스 사각형 */
  sourceRect() {
    const src = this.source();
    if (!src) return null;
    const { w, h } = src;
    if (!this.crop) return { x: 0, y: 0, w, h };
    const c = this.crop;
    const x = Math.max(0, Math.min(c.x, w - 1));
    const y = Math.max(0, Math.min(c.y, h - 1));
    return { x, y, w: Math.max(1, Math.min(c.w, w - x)), h: Math.max(1, Math.min(c.h, h - y)) };
  }

  /** 현재 프레임을 JPEG data URL로 캡처합니다. */
  grab(maxWidth = 1400, quality = 0.72) {
    const src = this.source();
    const r = this.sourceRect();
    if (!src || !r || !src.w) return null;
    const scale = Math.min(1, maxWidth / r.w);
    this.work.width = Math.max(1, Math.round(r.w * scale));
    this.work.height = Math.max(1, Math.round(r.h * scale));
    this.workCtx.drawImage(src.el, r.x, r.y, r.w, r.h, 0, 0, this.work.width, this.work.height);
    return this.work.toDataURL('image/jpeg', quality);
  }

  /** 변화 감지용 축소 그레이스케일 시그니처 */
  signature() {
    const src = this.source();
    const r = this.sourceRect();
    if (!src || !r || !src.w) return null;
    this.thumbCtx.drawImage(src.el, r.x, r.y, r.w, r.h, 0, 0, THUMB, THUMB);
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
