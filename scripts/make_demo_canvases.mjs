// 生成 README 演示用「好构图 vs 差构图」两张 480x300 画布 PNG（node 画布，用 pngjs 落盘）
// 差图特征（按 computeScore 公式反向设计）：覆盖率低(~4%)、质心左下角、单色
// 好图特征：覆盖率 ~26%、质心居中、6+ 主色、元素分布均衡
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/Users/Admin/Downloads/project/tiB_test/server/');
const { PNG } = require('pngjs');

const W = 480, H = 300;

function makeCanvas() {
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 252; png.data[i + 1] = 252; png.data[i + 2] = 252; png.data[i + 3] = 255;
  }
  return png;
}
// 圆头画笔描线（直线插值 + 圆头填充）
function stroke(png, pts, color, size) {
  const put = (x, y) => {
    const r = size / 2;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy <= r * r) {
          const px = Math.round(x) + dx, py = Math.round(y) + dy;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const idx = (W * py + px) << 2;
          png.data[idx] = color[0]; png.data[idx + 1] = color[1]; png.data[idx + 2] = color[2];
        }
      }
    }
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let s = 0; s <= n; s++) put(x0 + (x1 - x0) * s / n, y0 + (y1 - y0) * s / n);
  }
}
function fillRect(png, x0, y0, x1, y1, color) {
  for (let y = Math.round(y0); y < y1; y++) for (let x = Math.round(x0); x < x1; x++) {
    const idx = (W * y + x) << 2;
    png.data[idx] = color[0]; png.data[idx + 1] = color[1]; png.data[idx + 2] = color[2];
  }
}

// ---------- 差图：左下角一团小而偏的乱线，单色 ----------
const bad = makeCanvas();
const dark = [40, 40, 46];
stroke(bad, [[36, 236], [58, 196], [44, 156], [70, 128], [52, 96]], dark, 6);   // 左侧一条歪扭竖线
stroke(bad, [[30, 210], [96, 224], [118, 240]], dark, 5);                          // 底部小弧
stroke(bad, [[40, 150], [86, 132], [104, 118]], dark, 4);                          // 斜线
stroke(bad, [[56, 190], [88, 186]], dark, 3);
writeFileSync('/tmp/tib_bad.png', PNG.sync.write(bad));
console.log('bad saved');

// ---------- 好图：居中角色（红雨衣少女剪影）+ 地面 + 远山 + 电线杆，多色均衡 ----------
const good = makeCanvas();
// 天空渐变（黄昏：上暖橙下浅黄）——注意 palette distinct colors
for (let y = 0; y < 170; y++) {
  const t = y / 170;
  const r = Math.round(255 - 10 * t), g = Math.round(196 + 30 * t), b = Math.round(150 + 50 * t);
  for (let x = 0; x < W; x++) {
    const idx = (W * y + x) << 2;
    good.data[idx] = r; good.data[idx + 1] = g; good.data[idx + 2] = b;
  }
}
// 太阳
stroke(good, [[368, 60], [384, 60], [392, 72], [392, 88], [380, 98], [364, 92], [360, 74], [368, 60]], [255, 120, 90], 10);
// 远山（两座）
stroke(good, [[0, 178], [70, 128], [150, 170], [230, 140], [320, 176], [420, 150], [480, 180]], [120, 110, 140], 8);
// 地面
fillRect(good, 0, 176, 480, 300, [214, 170, 120]);
stroke(good, [[0, 176], [480, 172]], [150, 120, 90], 4);
// 主角：居中红雨衣少女（头/身/裙摆/腿），质心 ~ (0.47, 0.55)
const red = [200, 50, 60], skin = [245, 214, 190], hair = [60, 40, 40];
stroke(good, [[226, 96], [230, 108], [228, 120]], hair, 14);                 // 头发
stroke(good, [[230, 112], [236, 116], [232, 124]], skin, 10);                // 脸
stroke(good, [[228, 126], [222, 160], [218, 196]], red, 26);                 // 雨衣身体
stroke(good, [[218, 196], [204, 240], [212, 262]], red, 18);                 // 裙摆左
stroke(good, [[228, 196], [244, 238], [252, 262]], red, 18);                 // 裙摆右
stroke(good, [[210, 262], [208, 288]], [70, 60, 70], 8);                     // 左腿
stroke(good, [[250, 262], [254, 288]], [70, 60, 70], 8);                     // 右腿
stroke(good, [[226, 140], [196, 168]], red, 10);                            // 左臂（回眸姿态）
stroke(good, [[232, 140], [262, 166]], red, 10);                            // 右臂
// 电线杆 + 电线
const pole = [90, 84, 80];
stroke(good, [[420, 60], [420, 288]], pole, 7);
stroke(good, [[404, 78], [436, 78]], pole, 5);
stroke(good, [[404, 108], [436, 108]], pole, 5);
stroke(good, [[368, 78], [420, 88], [480, 72]], [70, 66, 64], 2);
// 左侧小巷一点远屋（平衡构图）
stroke(good, [[20, 176], [20, 120], [76, 108], [76, 176]], [150, 128, 120], 6);
stroke(good, [[20, 120], [48, 96], [76, 108]], [110, 96, 120], 5);
stroke(good, [[34, 132], [50, 132], [50, 150], [34, 150], [34, 132]], [255, 236, 170], 4); // 窗灯
stroke(good, [[58, 146], [70, 146], [70, 160], [58, 160]], [255, 236, 170], 4);
writeFileSync('/tmp/tib_good.png', PNG.sync.write(good));
console.log('good saved');
