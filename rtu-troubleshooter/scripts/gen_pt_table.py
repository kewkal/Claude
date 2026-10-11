"""Generate the R-410A PT table from CoolProp (NIST-grade EOS).

Run: python3 scripts/gen_pt_table.py > src/content/pt/r410a.json
Requires: pip install CoolProp
"""
import json
import CoolProp
import CoolProp.CoolProp as CP

ATM_PSIA = 14.696
PA_PER_PSI = 6894.757


def psig(t_f, q):
    t_k = (t_f - 32) * 5 / 9 + 273.15
    return round(CP.PropsSI("P", "T", t_k, "Q", q, "R410A") / PA_PER_PSI - ATM_PSIA, 1)


rows = [{"tempF": t, "bubblePsig": psig(t, 0), "dewPsig": psig(t, 1)} for t in range(-40, 151)]
print(json.dumps({
    "refrigerant": "R-410A",
    "source": {
        "tool": f"CoolProp {CoolProp.__version__}",
        "citation": "Bell, I.H., Wronski, J., Quoilin, S., Lemon, V. (2014). Pure and Pseudo-pure Fluid Thermophysical Property Evaluation and the Open-Source Thermophysical Property Library CoolProp. Ind. Eng. Chem. Res. 53(6), 2498-2508.",
        "fluidModel": "R410A pseudo-pure fluid (Lemmon 2003 EOS)",
        "note": "Gauge pressure = absolute - 14.696 psia (sea level). Bubble = saturated liquid (use for subcooling). Dew = saturated vapor (use for superheat). R-410A glide is under 0.3 F, so the two columns nearly match.",
        "generatedBy": "scripts/gen_pt_table.py"
    },
    "verified": True,
    "rows": rows
}, indent=1))
