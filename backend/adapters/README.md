# Regresión continua desde TensorFlow y PyTorch

Estas plantillas conectan un modelo local de confianza con la flexión continua de
los cinco dedos. No contienen pesos entrenados ni garantizan precisión de posición.
Ejecutar los comandos siguientes desde la raíz del proyecto, con el entorno `.venv`
ya creado e instaladas las dependencias básicas de `requirements.txt`.

## TensorFlow / Keras

Admite un archivo `.keras` o `.h5` de entrada única y salida única. Para capas
personalizadas, adaptar la carga aportando sus definiciones.

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/adapters/requirements-tensorflow.txt
$env:EMG_MODEL_MODULE = "backend.adapters.tensorflow_model"
$env:EMG_MODEL_PATH = "C:\ruta\modelo.keras"
$env:EMG_EXPECTED_SAMPLES = "200"
$env:EMG_OUTPUT_UNITS = "degrees"
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

## PyTorch / TorchScript

Admite un `.pt` exportado como **TorchScript**, en CPU. Un `state_dict` o un archivo
arbitrario de `torch.save` necesita su propia arquitectura y código de carga; no está
incluido en esta plantilla.

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/adapters/requirements-torch.txt
$env:EMG_MODEL_MODULE = "backend.adapters.torchscript_model"
$env:EMG_MODEL_PATH = "C:\ruta\modelo_torchscript.pt"
$env:EMG_EXPECTED_SAMPLES = "200"
$env:EMG_OUTPUT_UNITS = "degrees"
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Seleccionar el modelo personalizado en la interfaz. La versión del framework debe
ser compatible con la usada para guardar el artefacto. Los frameworks son opcionales
y no son necesarios para probar la demo.

## Entrada y salida

- Entrada: `float32`, **NTC = (1, EMG_EXPECTED_SAMPLES, 8)**. El ejemplo de 200 muestras
  equivale a 200 ms solo si el sensor opera a 1000 muestras/s. Usar el tamaño y la
  frecuencia del entrenamiento, manteniendo el mismo orden de los ocho canales.
- Salida: tensor **(1, 5)**, en orden **pulgar, índice, medio, anular, meñique**.
- `EMG_OUTPUT_UNITS="degrees"`: cinco valores continuos de 0 a 90 grados.
- `EMG_OUTPUT_UNITS="normalized"`: cinco valores continuos de 0 a 1 que se multiplican
  por 90; usarlo solo si coincide con la normalización de los objetivos entrenados.

El adaptador devuelve `{"angles":[...],"gesture":"continuous","confidence":null}`.
La etiqueta `continuous` identifica el modo dentro del protocolo y no selecciona
poses. Las salidas fuera de rango, no finitas o con dimensiones distintas provocan
un error; no se recortan silenciosamente.

**Adaptar `preprocess_window` en [common.py](common.py) al entrenamiento.** Actualmente
solo convierte a float32 y añade el eje de lote: no filtra, normaliza, reorganiza
canales ni extrae características. Un modelo que espere NCT u otra representación
necesita la transformación correspondiente. Una flexión por dedo es un contrato
cinemático simplificado; posición cartesiana, abducción o ángulos independientes de
cada articulación requieren ampliar tanto el adaptador como el visor.

Los pesos se precargan mediante `prepare()` antes de abrir COM; no se hace una
inferencia oculta de calentamiento. El servicio detiene la adquisición serie si
una inferencia/envío supera el salto o se acumulan más de 32 KiB de entrada pendiente.
El mensaje indicará aumentar el salto o reducir el costo del modelo. Reiniciar el
servidor cuando se modifique un archivo de pesos ya cargado.

El transporte COM está confirmado, pero el formato concreto del brazalete sigue
pendiente de verificar. El parser actual lee líneas CSV/JSON de ocho canales; un
protocolo binario necesita su decodificador, sin adivinar su estructura. El contrato
completo y las limitaciones de registro están en [la documentación del backend](../README.md).
