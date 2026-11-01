"""Vendor only selected Solar SVGs. Build/runtime need no icon service."""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "frontend"
MAPPING = {"capture":"microphone-2-linear","dashboard":"widget-2-linear","patients":"users-group-rounded-linear","records":"document-text-linear","mic":"microphone-2-linear","pulse":"heart-pulse-linear","check":"check-circle-linear","arrow":"arrow-right-linear","plus":"add-circle-linear","moon":"moon-linear","search":"magnifer-linear","shield":"shield-check-linear","clock":"clock-circle-linear","menu":"sidebar-minimalistic-linear","bell":"bell-linear","close":"close-circle-linear","chevron":"alt-arrow-down-linear","sun":"sun-2-linear"}
request = urllib.request.Request("https://raw.githubusercontent.com/iconify/icon-sets/master/json/solar.json", headers={"User-Agent":"FieldToRecord-icon-vendor"})
with urllib.request.urlopen(request, timeout=60) as response:
    data = json.load(response)
def resolve(name):
    if name in data["icons"]:
        return data["icons"][name]["body"]
    alias = data.get("aliases", {}).get(name)
    if alias:
        assert not any(alias.get(k) for k in ["rotate", "hFlip", "vFlip"]), "Unexpected icon transform"
        return resolve(alias["parent"])
    import difflib
    raise ValueError((name, difflib.get_close_matches(name, data["icons"], n=4)))
icons = {key:resolve(value) for key,value in MAPPING.items()}
source = '// Solar icons by 480 Design. CC BY 4.0. See public/credits.html.\nconst icons: Record<string,string> = '+json.dumps(icons)+';\nexport function Icon({name,size=20}:{name:string;size?:number}) {return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon-set="solar" dangerouslySetInnerHTML={{__html:icons[name]||icons.pulse}}/>;}\n'
(ROOT / "src/Icons.tsx").write_text(source, encoding="utf-8")
print(f"Bundled {len(icons)} Solar icons")
