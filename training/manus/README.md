# Primer modelo EMG → MANUS: continuar en otra PC

Este directorio prepara un primer experimento de **regresión continua**, sin clasificación de gestos. La descarga y preparación se ejecutan localmente; **el entrenamiento se deja para la otra PC**. Los comandos siguientes se ejecutan desde la raíz del proyecto.

**Estado al 18 de septiembre de 2026:** descarga completa y SHA-256 verificado de los 3.108 CSV. El conjunto activo `prepared_v2` contiene **2.919 ensayos, 5.767.720 filas y 555.150 ventanas**, de quince participantes. Pasaron quince pruebas locales y la comprobación de integridad de los datos preparados; dos pruebas de inferencia/exportación se omiten aquí porque PyTorch no está instalado y deben ejecutarse en el otro equipo. No se ha comprobado todavía la ejecución en GPU ni se han ajustado pesos. Ver [resumen de datos](reports/dataset_summary.json), [validación](reports/validation.json) y [pruebas locales](reports/local_checks.json).

| División | Personas | Ensayos | Filas | Ventanas |
|---|---:|---:|---:|---:|
| Entrenamiento | 10 | 1.955 | 3.824.022 | 367.927 |
| Validación | 2 | 393 | 758.324 | 72.912 |
| Prueba | 3 | 571 | 1.185.374 | 114.311 |

## Archivos y estado

- `datasets/semg_manus/raw/`: ZIP original, 3.108 CSV, licencia, codebook, manifest y comprobantes de integridad.
- `datasets/semg_manus/prepared_v2/`: matrices NumPy, normalización, separación de participantes y auditoría.
- `datasets/semg_manus/prepared_v1/`: preparación inicial conservada para auditar las etiquetas constantes; **usar v2 para entrenar**.
- `training/manus/`: scripts, configuración, pruebas y documentación para Git.
- `training/manus/reports/`: resumen y validaciones de esta preparación, sin señales completas.
- `training/manus/runs/`: futuro destino de pesos y resultados; no hay pesos entrenados en esta entrega.

`datasets/` y `training/manus/runs/` están excluidos de Git por su tamaño. El código se conserva en [Bladjot/Tesis](https://github.com/Bladjot/Tesis). Al clonar en la otra máquina, se pueden recrear los datos con los scripts o copiar íntegramente esas carpetas. No basta clonar para tener las señales. Para entrenar sólo hace falta la preparación activa `prepared_v2`; `prepared_v1` conserva la auditoría inicial.

## Protocolo inicial fijo

| Parámetro | Configuración |
|---|---|
| Entrada | Ocho canales EMG; se excluye IMU y toda señal del guante de las entradas |
| Objetivo | Veinte valores continuos MANUS, en el orden original del CSV |
| Frecuencia | 200 Hz **nominales**; los CSV no conservan tiempos originales |
| Ventana causal | 80 muestras, unos 400 ms nominales |
| Salto | 10 muestras, unos 50 ms nominales |
| Etiqueta | Última muestra de la ventana; sin desplazamiento temporal añadido |
| Entrenamiento | Participantes 5, 6, 8, 9, 10, 11, 12, 15, 16, 18 |
| Validación | Participantes 7 y 14 |
| Prueba reservada | Participantes 3, 4 y 13 |
| Exclusión de cohorte | Participantes incompletos 1, 2 y 17 |
| Normalización | Media y desviación estándar calculadas únicamente con filas de entrenamiento |
| Modelo | TCN pequeña, causal, veinte salidas; PyTorch |
| Pérdida | Smooth L1 sobre objetivos normalizados |
| Configuración de partida | Máximo 40 épocas, lote 256, parada temprana por validación |

Las divisiones se fijaron antes de inspeccionar métricas de modelos, mediante barajado con semilla 42. Una ventana nunca atraviesa ensayos. Se guardan señales sin expandir todas las ventanas: el lector usa memoria mapeada, evitando una copia grande por cada ventana solapada.

No se añaden filtros, recortes a 0–90°, ni sustituciones de ángulos por posturas. La señal Myo ya puede incluir procesamiento del dispositivo. Se excluyen registros con valores no finitos en columnas usadas, demasiado cortos, duplicados exactos de entrada/objetivos o con las veinte salidas exactamente constantes durante toda la grabación. Esta última regla elimina 50 registros sospechosos de congelamiento del guante, con EMG variable; se aplica por igual a los tres grupos antes del entrenamiento. Las anomalías conocidas de cantidad de ensayos se conservan y señalan si los registros son válidos. Se preservan los originales.

## Preparar datos después de clonar

Python 3.11 o 3.12 recomendado. Crear un entorno separado del simulador:

```powershell
python -m venv .venv-manus
.\.venv-manus\Scripts\python.exe -m pip install -r training/manus/requirements-prepare.txt
.\.venv-manus\Scripts\python.exe training/manus/download.py --root datasets/semg_manus/raw
.\.venv-manus\Scripts\python.exe training/manus/prepare.py --raw datasets/semg_manus/raw --output datasets/semg_manus/prepared_v2
.\.venv-manus\Scripts\python.exe training/manus/validate_prepared.py --data datasets/semg_manus/prepared_v2
```

En Linux se sustituye `.\.venv-manus\Scripts\python.exe` por `.venv-manus/bin/python`. El ZIP pesa 594,4 MB y los CSV aproximadamente 6,51 GB, más las matrices preparadas y espacio temporal. La descarga verifica los hashes publicados; la preparación verifica además el SHA-256 de cada CSV. Si `prepared_v2` ya existe con contenido, se valida o se usa otro nombre de salida; el preparador no lo sobrescribe.

## Antes de entrenar, en la otra PC

Instalar una versión de PyTorch compatible con la GPU y su controlador siguiendo el [selector oficial](https://pytorch.org/get-started/locally/). Ejecutar el comando elegido con el Python de `.venv-manus`: sustituir su `pip` o `pip3` inicial por `.\.venv-manus\Scripts\python.exe -m pip` (en Linux, `.venv-manus/bin/python -m pip`), conservando los paquetes y el índice indicados. Luego:

```powershell
.\.venv-manus\Scripts\python.exe -m pip install -r training/manus/requirements-train.txt
.\.venv-manus\Scripts\python.exe -m unittest discover -s training/manus/tests -v
.\.venv-manus\Scripts\python.exe -c "import torch; print(torch.__version__); print('CUDA disponible:', torch.cuda.is_available())"
```

Las pruebas usan muestras sintéticas pequeñas, lectura de datos y, cuando PyTorch está disponible, inferencia sin ajustar pesos. El entrenamiento exige CUDA por defecto y se detiene si no está disponible. No usar `--allow-cpu` para lanzar accidentalmente un entrenamiento en esta PC.

Para usar el notebook opcional, instalar `jupyterlab ipykernel` con ese mismo Python (`python -m pip install jupyterlab ipykernel`, usando la ruta del entorno) y abrir Jupyter con `python -m jupyterlab`. Seleccionar el kernel de `.venv-manus`. Estas dependencias no son necesarias para los comandos de terminal.

## Entrenar y evaluar únicamente en la otra PC

```powershell
.\.venv-manus\Scripts\python.exe training/manus/train.py --data datasets/semg_manus/prepared_v2 --output training/manus/runs/first_run --epochs 40 --batch-size 256
```

El script selecciona los pesos mediante validación, guarda `best.pt`, configuración, historial y versiones del entorno. No evalúa la prueba reservada durante el ajuste. Si la GPU no tiene memoria suficiente, reducir `--batch-size`; usar un directorio de ejecución nuevo para conservar resultados.

La evaluación final y la exportación se realizan después de congelar el modelo y sus decisiones:

```powershell
.\.venv-manus\Scripts\python.exe training/manus/evaluate.py --data datasets/semg_manus/prepared_v2 --checkpoint training/manus/runs/first_run/best.pt --output training/manus/runs/first_run/test_metrics.json --export training/manus/runs/first_run/model.ts
```

La evaluación compara con la predicción constante calculada en entrenamiento y reporta MAE/RMSE por salida. Guarda una marca junto al checkpoint para evitar repetir accidentalmente la prueba. Una exportación posterior sin evaluar nuevamente se ejecuta con `--export-only --export RUTA_NUEVA`, conservando `--data` y `--checkpoint`. Consultar `python training/manus/evaluate.py --help` o el notebook `entrenamiento_en_otra_pc.ipynb`. No usar repetidamente la prueba reservada para elegir hiperparámetros.

## Interpretación e integración

Se predicen las **salidas nativas del guante**, no se garantiza todavía una exactitud anatómica en grados. El pulgar usa nombres genéricos `thumb_mcp/pip/dip` en el CSV; el mapa CMC/MCP/IP debe verificarse contra la versión MANUS empleada. No convertir automáticamente estos nombres a articulaciones del simulador.

El exportado previsto recibe EMG cruda con forma `[lote, 80, 8]` y devuelve `[lote, 20]`, incluyendo la normalización del entrenamiento. El adaptador actual del simulador espera cinco flexiones: habrá que ampliar su contrato o crear una conversión explícita antes de conectar este modelo. El recorte físico de la animación no debe alterar las métricas calculadas sobre la predicción original.

Para transferir a EMG PRO se deben confirmar protocolo COM, frecuencia, unidades, orden de canales, filtrado y colocación de electrodos. La evaluación con sujetos nuevos del dataset no equivale a evaluar otro dispositivo.

## Origen y licencia

Graf, Max; Barthet, Mathieu. **sEMG-MANUS dataset**, versión 1.0. [Zenodo 19261324](https://zenodo.org/records/19261324), DOI 10.5281/zenodo.19261324. Datos publicados bajo **CC BY 4.0**. Al publicar derivados, conservar atribución, enlace de licencia y descripción de las transformaciones. La documentación del autor se conserva junto al ZIP. Ver también `DATASET_CARD.md`.
