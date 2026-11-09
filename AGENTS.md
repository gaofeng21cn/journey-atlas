# Journey Atlas 维护约定

这是一个本地优先的旅行地图生成器。代码、公共资源、字段规范、示例和测试进入 Git；个人地点、交通、照片、GPS、票据、正文、输出和缓存留在使用者自己的工作区。

## 维护原则

- 事实源只有用户配置的数据源；网站、PNG、CSV 汇总和构建清单都是派生物。
- 地点、行程、移动分别维护。新增地点时同时提供活动窗口、前后移动和证据引用。
- 通过地点编号、交通节点编号和段序构造连续路线；不要用地名模糊匹配或几何最近点伪造接续。
- 允许有依据的合理重建，并单独保存数值来源和计程口径；未知连接可保留，但不得伪造精确日期、方式或里程。
- 任何公共地图资源都必须在 `NOTICE.md` 登记来源、许可和署名要求。

## 常用命令

```sh
npm run init:data -- --source data/source
npm run check:data
npm run build
npm run site:build
npm test
npm run verify
```

使用 Obsidian 时，在私有 `data/atlas-config.json` 设置 `vault`；使用通用本地源时设置 `dataSource.path`。两种入口都归一到同一套 schema 和派生流程。

已有布局通过 `dataSource.files`、`tableDirectory` 和 `referenceRoots` 显式绑定；读取、更新、回滚、回执和指纹必须复用 `source-data.mjs` 的实际路径解析，不另拼固定表名。不要为接入工具复制一套个人知识源。

## 变更边界

`scripts/schema.mjs` 拥有字段契约，`scripts/source-data.mjs` 拥有源表初始化和导入，`scripts/atlas-data.mjs` 负责只读装载，`scripts/update-atlas.mjs` 是唯一正式写入入口，`src/` 和 `scripts/render-*.mjs` 只负责呈现。不要在渲染器中写入维护源，也不要把个人适配写进通用模块。

提交前运行 `npm test`、`npm run package:check` 和与改动相关的站点检查。不要提交 `data/atlas-config.json`、`data/profile.json`、`inputs/`、`private/`、`outputs/`、`site-dist/` 或个人地图证据。
