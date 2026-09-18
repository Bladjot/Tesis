"""Figura exploratoria de una muestra; no mide precisión predictiva."""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parent
data = np.loadtxt(root / "fuentes/manus_muestra_flexext_fist.csv", delimiter=",")
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
fig, axes = plt.subplots(2, 1, figsize=(11, 6), sharex=True)
fig.suptitle("sEMG-MANUS: señal muscular y trayectoria continua del índice", x=0.08, ha="left", fontsize=15, fontweight="bold")
axes[0].plot(data[:, 0], color="#2679b2", linewidth=.65)
axes[0].set_ylabel("EMG canal 1\n(unidades del dispositivo)")
axes[0].set_title("Participante 3 · sesión 1 · flexión/extensión del puño · velocidad media", loc="left", fontsize=10, color="#465461")
for column, label, color in [(23, "MCP · nudillo", "#2179b5"), (24, "PIP · articulación media", "#d5771d"), (25, "DIP · articulación distal", "#218f75")]:
    axes[1].plot(data[:, column], label=label, color=color, linewidth=1.5)
axes[1].set_ylabel("Salida angular MANUS\n(valor exportado)")
axes[1].set_xlabel("Número de muestra en el CSV (sin timestamps originales)")
axes[1].legend(loc="lower left", bbox_to_anchor=(0, 1.01), ncol=3, frameon=False, fontsize=9)
for ax in axes:
    ax.grid(alpha=.18)
    ax.set_xlim(0, len(data)-1)
fig.text(.08, .025, "Fuente: Graf y Barthet, Zenodo 19261324 · CC BY 4.0. Figura propia de una grabación; no es una predicción del modelo.", fontsize=8, color="#465461")
fig.subplots_adjust(left=.115, right=.975, top=.86, bottom=.13, hspace=.35)
fig.savefig(root / "muestra_manus.png", dpi=160)
plt.close(fig)
