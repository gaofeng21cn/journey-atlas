# Journey Atlas 第三方资源说明

MIT 许可证只适用于本项目原创代码、字段规范、示例和测试。地图与行政边界来自不同上游，必须分别遵守其许可和署名要求。

本清单描述 `journey-atlas` 的公开发行内容。`travel-passport` 个人工作区可保留同名的 dataofjapan、BFS / GEOSTAT 或 DataV 旧资源；这些本地文件并未因此变成 Natural Earth 数据，其来源条款仍按“本地可选资源”执行。

## 当前公开发行随附的资源

- `data/geographic-context.json`：Natural Earth，Public Domain。来源：[naturalearthdata.com](https://www.naturalearthdata.com/about/terms-of-use/)。
- `data/japan.topojson`、`data/swiss-cantons.topojson`、`data/switzerland.geojson`、`data/china.geojson`：由 `scripts/prepare-open-geography.mjs` 从仓库内 `data/geographic-context.json` 的 Natural Earth 行政区生成。生成文件标记 `Natural Earth · Public Domain`，仅保留公开行政区边界和本项目单元编号。
- `data/europe-countries.topojson`、`data/europe.geojson`、`data/greece.geojson`、`data/greece-regions.geojson`、`data/southeast-asia.geojson`：Natural Earth，Public Domain。来源：[naturalearthdata.com](https://www.naturalearthdata.com/about/terms-of-use/)。
- `data/usa.geojson`、`data/us-states.topojson`：U.S. Census Bureau / `us-atlas`。美国政府行政数据属公有领域；`us-atlas` 的项目许可和来源说明见 [github.com/topojson/us-atlas](https://github.com/topojson/us-atlas)。
- `data/italy.geojson`、`data/italy-regions.geojson`：Openpolis `geojson-italy`，CC BY 4.0。来源：[github.com/openpolis/geojson-italy](https://github.com/openpolis/geojson-italy)。使用或改编时保留署名和许可链接。

香港海岸、城市行政区、道路背景及其他城市级文件不在当前公开发行清单中；它们属于个人工作区的可选资源，不能按本文件的公开资源条款理解。

## 本地可选资源

以下资源由使用者按需下载或自行生成，不包含在公开仓库：

- 日本全国县界与东京特别区界：dataofjapan / 地球地図日本，要求署名；商业使用按上游说明办理：[github.com/dataofjapan/land](https://github.com/dataofjapan/land)。
- 瑞士州界：BFS / GEOSTAT 地理数据为非商业条件，须署名“Bundesamt für Statistik (BFS), GEOSTAT”：[github.com/interactivethings/swiss-maps](https://github.com/interactivethings/swiss-maps)。公开替代边界可用 `prepare-open-geography.mjs` 生成。
- 中国省级、广东地级市、广州行政区 DataV 接口可以下载，但接口未给出明确再分发许可。更细 DataV 边界仅本地使用或在确认许可后使用。
- 京都区界下载目录目前指向第三方加工副本，未发现独立许可证；公开分发前应从日本国土交通省 KSJ N03 许可来源重新生成。
- 香港18区使用香港政府开放数据，下载后按 [data.gov.hk 条款](https://data.gov.hk/en/terms-and-conditions) 保留政府及数据提供部门署名。
- 新加坡规划区下载副本须保留 URA / geoBoundaries 来源和 Singapore Open Data Licence 1.0 说明。
- 纽约行政区由 NYC Department of City Planning 开放数据派生，下载副本应保留来源和改编说明：[data.cityofnewyork.us](https://data.cityofnewyork.us/)。

## 道路与底图

OpenStreetMap 数据遵循 ODbL，地图展示应包含 “© OpenStreetMap contributors”。OpenFreeMap 的矢量地图署名应包含 “OpenMapTiles · Data from OpenStreetMap”。日本国土地理院数据按其 PDL 1.0 标注来源。城市背景和道路不是到访证据，也不能决定地点或交通事实。
