# 十二生肖套圈游戏

这是可在浏览器运行的本地三维套圈游戏。入口是 [hi3d-game.html](hi3d-game.html)。

在仓库目录启动本地 HTTP 服务（例如 `python -m http.server 8000`），然后打开 `http://127.0.0.1:8000/hi3d-game.html`。游戏需要支持 WebGL2 和 WebAssembly 的浏览器；脚本、物理引擎、场景及生肖模型都在仓库内，无需运行时 CDN。

网页代码和配置在根目录。`assets/hi3d-fair-full3d.glb` 是场景，`assets/characters-web/` 包含 12 个网页用生肖模型，`vendor/` 包含 Three.js 0.170.0（MIT）和 Rapier3D Compat 0.17.3（Apache-2.0）及其许可证。原始高精度模型和 Blender 工程文件未纳入此运行包。

操作：指向生肖并拖动调整落点，松手投圈；`1`/`2` 切换高低抛，空格投掷，`Esc` 或 `P` 暂停。可以选择关卡或练习模式。
