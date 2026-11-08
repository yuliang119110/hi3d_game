# 十二生肖套圈游戏

这是可在浏览器运行的本地三维套圈游戏。入口是 [hi3d-game.html](hi3d-game.html)。

在仓库目录启动本地 HTTP 服务（例如 `python -m http.server 8000`），然后打开 `http://127.0.0.1:8000/hi3d-game.html`。游戏需要支持 WebGL2 和 WebAssembly 的浏览器；脚本、物理引擎、场景及生肖模型都在仓库内，无需运行时 CDN。

网页代码和配置在根目录。`assets/hi3d-fair-full3d.glb` 是场景，`assets/characters-web/` 包含 12 个网页用生肖模型，`vendor/` 包含 Three.js 0.170.0（MIT）和 Rapier3D Compat 0.17.3（Apache-2.0）及其许可证。原始高精度模型和 Blender 工程文件未纳入此运行包。

操作：指向生肖并拖动调整落点，松手投圈；`1`/`2` 切换高低抛，空格投掷，`Esc` 或 `P` 暂停。可以选择关卡或练习模式。

音乐与音效位于 `assets/audio/`，由 `hi3d-soundscape.js` 管理。`hi3d-year-of-the-iron-dragon.mp3` 是用户提供的背景音乐，默认以 10% 增益循环播放，命中提示时短暂降低。其余音频是本项目合成的无词人群低语、投圈风声、落圈轻敲与短鼓掌。点击开始或声音按钮后才启用音频；暂停、静音或切到后台会停止播放，恢复后接着播放。右上角声音按钮统一控制音乐和音效。

右上角“手势”按钮可开启摄像头投圈：手腕收回肩前停一下取圈，再向前上方挥手出圈。支持左右手、镜像预览、场景持圈跟随和实时物理数据显示；关闭即释放摄像头。MediaPipe Pose 模型随包提供，视频仅在浏览器本地处理。使用方法与动作映射边界见 [hi3d-gesture-notes.md](hi3d-gesture-notes.md)。
