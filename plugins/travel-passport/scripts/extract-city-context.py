"""Extract public OSM roads, rivers and railways; no private observations."""
import json
import sys
import osmium

west, south, east, north = json.loads(sys.argv[3])

class Context(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.features = []

    def way(self, way):
        highway = way.tags.get('highway', '')
        water = way.tags.get('waterway', '') in ('river', 'canal')
        rail = way.tags.get('railway', '') == 'rail'
        if not water and not rail and highway not in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary'):
            return
        try:
            points = [[n.lon, n.lat] for n in way.nodes]
        except osmium.InvalidLocationError:
            return
        if len(points) < 2 or not any(west <= x <= east and south <= y <= north for x, y in points):
            return
        self.features.append({'type': 'Feature', 'properties': {
            'kind': 'water' if water else 'rail' if rail else 'road',
            'major': highway in ('motorway', 'trunk', 'primary')},
            'geometry': {'type': 'LineString', 'coordinates': points}})

handler = Context()
handler.apply_file(sys.argv[1], locations=True)
if not handler.features:
    raise ValueError('No public geographic context inside catalogue bounds')
with open(sys.argv[2], 'w') as target:
    json.dump({'type': 'FeatureCollection', 'features': handler.features}, target, separators=(',', ':'))
print(f'Public OSM context: {len(handler.features)} roads/rivers/railways')
