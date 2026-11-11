# Journey Atlas

Journey Atlas 是一个本地优先的旅行数据可视化工具：把地点、行程和交通组成一份有向旅行账本，生成 Flighty 风格的旅行护照 PNG/SVG、可交互的多尺度地图，以及可供 Agent 读取的 OPL App 贡献视图。

Journey Atlas 是 OPL MiniApp，产品类型为应用。稳定 Package ID 为 `travel-passport`，公开项目名和仓库名为 `journey-atlas`。个人旅行事实、照片、GPS、票据和 Obsidian 路径不在发行包中；它们只在使用者自己的工作区保存。

## 安装与管理

在 OPL 软件中心搜索 **Journey Atlas**，使用默认正式版安装、更新或卸载。公开来源为 `ghcr.io/gaofeng21cn/one-person-lab-packages/travel-passport:latest-stable`，安装和版本切换由现有 Package carrier 管理。软件源中的可用版本以已发布制品为准。

发行包包含执行代码、公共地图、锁定依赖清单和共享 UI adapter。CLI 从选定安装执行，`--workspace` 只指定私人数据，不执行该目录里的程序：

```sh
node <安装目录>/journey-atlas.mjs version
node <安装目录>/journey-atlas.mjs --workspace <私人工作区> init
node <安装目录>/journey-atlas.mjs --workspace <私人工作区> import --input <用户资料.json>
node <安装目录>/journey-atlas.mjs --workspace <私人工作区> status --json
node <安装目录>/journey-atlas.mjs --workspace <私人工作区> site build
```

首次 CLI 调用会使用 `npm ci --ignore-scripts` 安装锁定依赖。共享视图的读取始终只读；缺少依赖时显示“初始化运行环境”，经确认后调用同一 setup。PNG 导出复用已有 Chrome 或 Playwright Chromium，需要时使用 Playwright 原生安装入口。更新和卸载只处理软件安装，保留工作区、Obsidian、输出、备份和操作回执。详见 [安装与共享基座](docs/安装与共享基座.md)。

## 快速开始

需要 Node.js 22 或更新版本。首次使用先安装依赖与导出浏览器：

```sh
npm ci
npx playwright install chromium
npm run init:data -- --source data/source
npm run import:data -- --input examples/import-bundle.json
npm run site:build
npm run site:check
npm run build -- --scope world --variant social
```

`init:data` 会创建一组空的标准 CSV/JSON 源表。`import-bundle.json` 是包含完整地点、行程、移动和到访实例的虚构往返示例；导入到个人库前先替换为自己的记录。将自己的数据按 `examples/` 中的字段填入后，运行：

```sh
npm run check:data
npm run build
npm run site:build
npm test
```

让 Agent 导入时，先读取 `docs/维护流程.md` 和 `examples/import-bundle.json`，把用户提供的旅行资料转换为相同字段，并保留证据引用；导入后执行 `check:data`、`build` 和 `verify`。

也可以把一次导入交给 Agent：`scripts/source-data.mjs` 的 `importSourceBundle()` 接受版本化 JSON，按稳定编号合并到用户自己的 `data/source/`，遇到重复编号或未知字段会停止，不覆盖原始文件。Obsidian 是可选连接器；在 `data/atlas-config.json` 中设置 `vault` 或 `dataSource` 即可切换。

已有维护表可通过 `dataSource.files` 和 `referenceRoots` 直接绑定；Obsidian 支持自定义 `tableDirectory`。无需复制已有表和正文，读取、更新、回滚与构建沿用同一来源配置，详见 [输入目录约定](docs/输入目录约定.md)。

导入文件使用 `version: 1` bundle，支持 `coverage`、`flightArchive`、`ground`、`japanPlaces`、`regionPlaces`、`journeys`、`visits` 和城市细节字段；行字段沿用 `scripts/schema.mjs`。地图行政区默认来自 Natural Earth Public Domain。需要细分边界时，可执行 `npm run geography:check` 预览映射，再用 `node scripts/prepare-open-geography.mjs --output data/site-cache/open-geography` 生成日本、瑞士和中国的可替换公开边界；城市行政区与道路图层按需运行 `node scripts/fetch-city-geography.mjs <city-id>`，资源会遵循各自来源许可留在本地。

## 数据边界

维护数据分为地点、行程、移动三层。地点保存永久身份和行政归属，行程保存一次活动及时间窗口，移动保存有向端点、方式、距离、时长和证据。城市轨迹、区域汇总、候选接续、网站和图片都是派生物，不能手改后当作事实源。

每条事实可以分别记录核定结论、证据引用、距离来源、时长来源和是否计入统计。`observed`、`archived`、`reference`、`model`、`unknown` 描述数值来源；合理估算可以进入可视化，但不会伪装成实测。节点编号和显式段序用于保证连续路线，避免孤立地点和几何就近重排。

## 产物

- `npm run build`：从当前源表生成静态护照、SVG、派生表和构建清单。
- `npm run site:build`：生成离线动态地图；默认展示全球，可切换大区、国家、行政区和城市。
- `npm run annual -- --year 2026`：生成年度旅行卡（若工作区提供该年度数据）。
- `npm run status -- --json`：读取构建新鲜度、数据质量和主要统计。
- `npm run verify`：运行源码、数据、连续性、边缘节点和离线网站检查。
- `npm run package:check`：确认 OPL Package 与插件载体同步。

PNG/SVG 导出使用浅纸纹、蓝色上下边缘、点阵和方向弧线；网站使用浅纸色地图界面。静态导出与交互网站共用同一份派生账本。

## Agent 原生入口

项目复用 OPL Package 载体和标准 app contribution adapter；技术加载角色 `capability_package` 不改变应用类型。Agent 可以读取：

- `travel.passport.v1#status`：构建与质量状态；
- `travel.passport.v1#overview`：全球摘要及可用产物；
- `travel.passport.v1#annual`：年度旅行卡摘要；
- `travel.passport.v1#regions`：按旅行强度排序的分区护照清单。

复杂地图探索保留为离线网页，结构化摘要和产物引用通过 OPL 共享视图暴露；两者读取同一个工作区，不建立第二份个人数据源。

## 地图数据与许可

代码按 MIT 许可发布。仓库随附的地图数据使用 Public Domain 与明确标注的第三方许可；`NOTICE.md` 列明每项来源与署名。可选城市行政区和道路资源不随仓库分发，下载后留在本地。不要将私人定位或票据提交到 Git。

## 隐私与贡献

提交前检查 `git status --ignored`。以下内容不得进入公开仓库：姓名、航班明细、旅行正文、照片、GPS、邮箱附件、Vault 绝对路径、生成图片、运行缓存和个人补丁。通用字段、算法、无个人信息的 fixture、地图下载器和测试可以贡献。

问题反馈请附最小化的虚构输入或脱敏片段，不要上传原始旅行记录。
