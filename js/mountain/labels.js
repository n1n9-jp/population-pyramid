// canvas の中に描く文字（軸の目盛り・軸名）。Sprite に文字を描き、画面上で一定の大きさに保つ。
import * as THREE from 'three';

const FONT = '"Hiragino Sans","Noto Sans CJK JP","Noto Sans JP","Yu Gothic",Meiryo,sans-serif';

export class LabelSet {
  constructor() { this.items = []; this.group = new THREE.Group(); this.group.renderOrder = 10; }

  /**
   * @param text 文字列
   * @param posA 地形型での位置 [x,y,z]（null なら地形型では出さない）
   * @param posB ピラミッド型での位置（null ならピラミッド型では出さない）
   * @param style { size, color, weight, anchor:[cx,cy] }
   */
  add(text, posA, posB, style = {}) {
    const item = { text, posA, posB, style, sprite: null, pxW: 0, pxH: 0 };
    this._draw(item);
    this.items.push(item); this.group.add(item.sprite);
    return item;
  }

  setText(item, text) { if (item.text === text) return; item.text = text; this._draw(item); }

  _draw(item) {
    const { size = 11, color = '#777', weight = 400, anchor = [0.5, 0.5], halo = true, onTop = false } = item.style;
    const dpr = 2;
    const c = document.createElement('canvas'), g = c.getContext('2d');
    const font = `${weight} ${size * dpr}px ${FONT}`;
    g.font = font;
    const w = Math.ceil(g.measureText(item.text).width) + 8 * dpr, h = Math.ceil(size * 1.5 * dpr);
    c.width = w; c.height = h;
    g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
    if (halo) { g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineJoin = 'round'; g.strokeText(item.text, w / 2, h / 2); }
    g.fillStyle = color; g.fillText(item.text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    if (item.sprite) { item.sprite.material.map.dispose(); item.sprite.material.map = tex; item.sprite.material.needsUpdate = true; }
    else {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: !onTop, depthWrite: false, sizeAttenuation: false });
      item.sprite = new THREE.Sprite(m); item.sprite.renderOrder = 10;
      item.sprite.center.set(anchor[0], anchor[1]);
    }
    item.pxW = w / dpr; item.pxH = h / dpr;
  }

  /** 形の補間 t（0＝地形型、1＝ピラミッド型）とカメラに合わせて、位置・不透明度・大きさを更新する */
  update(t, camera, viewH, offsetB = null, sizeFactor = 1) {
    const k = sizeFactor * 2 / (viewH * camera.projectionMatrix.elements[5]);
    for (const it of this.items) {
      const sp = it.sprite;
      let op;
      if (it.posA && it.posB) {
        op = 1;
        const a = it.posA, b = it.posB;
        sp.position.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      } else if (it.posA) { op = Math.max(0, 1 - t * 2); sp.position.set(...it.posA); }
      else {
        op = Math.max(0, t * 2 - 1);
        const b = it.posB;
        sp.position.set(b[0], b[1], b[2] + (offsetB && it.style.front ? offsetB : 0));
      }
      if (it.hidden) op = 0;
      sp.material.opacity = op; sp.visible = op > 0.01;
      sp.scale.set(it.pxW * k, it.pxH * k, 1);
    }
  }

  dispose() { for (const it of this.items) { it.sprite.material.map.dispose(); it.sprite.material.dispose(); } }
}
