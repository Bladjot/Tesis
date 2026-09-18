# Adquisición EMG y adaptadores de modelos

Este servicio local recibe muestras, calcula ventanas y envía comandos cinemáticos
al visor. No representa fuerzas, anatomía clínica ni contacto físico. La demostración
usa ruido sintético y una regla RMS; no es un modelo entrenado ni una validación de
la tesis. La conexión física al sensor debe comprobarse con el dispositivo real.

## Ejecutar

Desde la raíz del proyecto, con Python 3.10 o posterior:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

El backend sirve `frontend/dist` en `/` si ese directorio existe cuando se inicia.
Construir la interfaz antes de arrancarlo, o reiniciar después de construirla.
En desarrollo permite CORS desde `http://localhost:5173` y
`http://127.0.0.1:5173`. Mantenerlo enlazado a `127.0.0.1`: no tiene autenticación
de usuarios y está concebido para una estación de trabajo local.

## Sensor serie

`GET /api/ports` enumera los dispositivos como
`{"ports":[{"device":"COM3","description":"USB Serial"}]}`.
El servicio solo abre puertos enumerados, sin enviar comandos al dispositivo.
La apertura del puerto puede reiniciar algunas placas por sus líneas DTR/RTS.
La adquisición comienza al conectar el WebSocket y finaliza al desconectarlo.

Cada línea UTF-8 representa **una muestra simultánea de todos los canales**:

```text
0.012,-0.034,0.018,0.009,-0.014,0.025,0.003,-0.011
0.018,-0.029,0.015,0.012,-0.011,0.019,0.008,-0.015
```

También se acepta JSON por línea:

```json
{"values":[0.012,-0.034,0.018,0.009,-0.014,0.025,0.003,-0.011],"t":12.3}
```

Enviar un salto de línea `\n` al terminar cada muestra. CSV no admite encabezados,
timestamp ni separadores adicionales; la cantidad de valores debe coincidir con
`channels`. El `t` opcional de JSON se valida, pero **no controla la temporización ni
se reenvía**: el tiempo del gráfico se obtiene del número de muestras aceptadas y
`sample_rate`. Por ello no detecta muestras perdidas ni deriva del reloj del sensor.
Los valores se mantienen en unidades crudas; no se convierten automáticamente de
cuentas ADC a voltios. Las líneas corruptas se descartan y se informa su número.

La configuración predeterminada utiliza los ocho canales del brazalete indicado.
El usuario confirmó el transporte por puerto COM serie. Aún debe verificarse el
formato de las tramas: si envía paquetes binarios o datos propietarios, se necesita
un parser del protocolo o del SDK que preserve los ocho canales y su frecuencia real.
El parser actual admite únicamente las líneas CSV/JSON descritas aquí; no presupone
el formato específico del brazalete EMG PRO.

Configurar en el firmware la frecuencia real y la velocidad serie. El valor
`sample_rate` del visor describe esa frecuencia: no reprograma el dispositivo.
Comprobar que el baudrate soporta todos los bytes enviados; por ejemplo, texto
multicanal a 1 kHz puede superar 115200 baudios. Ajustar la tasa, la representación
o el baudrate de ambos extremos según corresponda.

No hay filtros aplicados a la señal recibida: una señal ADC con offset puede producir
una RMS dominada por ese offset. El firmware o el adaptador de modelo debe aplicar
exactamente la conversión, eliminación de offset y filtros usados al entrenar.
`rest` y `mvc` son niveles **RMS** de reposo y referencia de contracción, en las mismas
unidades de la señal recibida; los valores predeterminados sirven solo para la demo.
La activación es `clip((mean(RMS_canales) - rest) / (mvc - rest), 0, 1)`.

### Detección de sobrecarga

La adquisición serie se detiene con un error visible si los bytes pendientes en el
driver más el buffer del servicio superan **32 KiB**, o si procesar/enviar una ventana
supera su **salto (`hop_ms`)**. La comprobación de inferencia ocurre antes de enviar
los ángulos, y se comprueba también el tiempo de envío. Cada lectura se limita a
4096 bytes. Estas protecciones evitan continuar acumulando trabajo con datos cada
vez más antiguos; no descartan muestras para fingir que se sostiene el tiempo real.
Un error termina el registro en la última trama recibida y cierra el puerto: las
muestras todavía pendientes no se consideran registradas. Aumentar el salto o usar
un modelo más rápido, y revisar frecuencia, baudrate y formato de las tramas.

El límite de bytes no constituye una garantía de latencia física: no se conoce el
tamaño ni reloj de los paquetes del sensor, y no se detectan pérdidas previas en el
dispositivo. Validar la tasa efectiva y el tiempo extremo a extremo con el hardware.

## WebSocket

Conectar a `ws://127.0.0.1:8765/ws/emg` y enviar en los primeros 10 segundos:

```json
{"source":"demo","baudrate":115200,"sample_rate":1000,"channels":8,"window_ms":200,"hop_ms":50,"rest":0.05,"mvc":0.6,"model":"baseline"}
```

Para el sensor usar `"source":"serial","port":"COM3"`. Las opciones son inmutables
durante una conexión: desconectar y conectar de nuevo para cambiarlas. Se admiten
1–8 canales, 10–5000 muestras/s, ventanas de 50–2000 ms y saltos de 10–1000 ms que no
superen la ventana. Los tamaños en muestras se redondean al entero más cercano.
La primera trama necesita una ventana completa; las siguientes se emiten cada salto.
La demo produce lotes de aproximadamente 50 ms; un modelo lento puede reducir su
velocidad efectiva, sin crear una cola ilimitada de inferencias.

Mensajes enviados:

- `{"type":"status","message":"..."}`: cambios de estado y problemas de formato.
- `{"type":"error","message":"..."}`: error y cierre de la conexión.
- `type: "frame"`: `timestamp` en segundos de señal; `samples` como lista de
  `{t, values}`; `rms` y `mav` por canal; `activation` entre 0 y 1; `angles` como cinco
  ángulos en grados entre 0 y 90, en orden pulgar, índice, medio, anular, meñique;
  `gesture`; `confidence`; `latency_ms`; `sample_count`; `source`; `model`; `unit`;
  `sample_rate`, `window_ms` y `hop_ms`.

`samples` contiene **todas** las muestras válidas nuevas, sin reducción ni repetición
por el solapamiento entre ventanas. La primera trama contiene la ventana inicial
completa; después cada trama contiene un salto completo. La inferencia recibe la
ventana completa, que sí puede solaparse con la anterior. Los máximos son 10 000
muestras en la primera trama y 5000 en cada salto, con hasta ocho canales.
`sample_count` cuenta las muestras válidas desde el inicio. Concatenar `samples`
permite registrar todas las muestras que llegaron en tramas; cualquier reducción
para dibujar debe hacerse solo sobre una copia en la interfaz. Un cierre inmediato
puede dejar un salto parcial pendiente sin emitir (o la ventana inicial incompleta);
el registro termina en el `sample_count` de la última trama recibida. Esto no confirma
que el sensor no haya perdido muestras antes de que el backend las recibiera.

`latency_ms` mide extracción de características e inferencia en el servidor; excluye
adquisición, espera de ventana, transporte, cola del puerto y renderizado. No mide
latencia física extremo a extremo. `unit` es `normalized` para la demo sintética
(valores limitados a ±1) y `raw` para el puerto serie. `confidence` es `null` en el
control RMS; no se calcula precisión ni confianza ficticia. Los gestos del control
RMS son `open`, `proportional` y `fist`.

Las conexiones del navegador validan `Origin` contra localhost/127.0.0.1 en los
puertos 5173 y 8765. Clientes locales sin `Origin` pueden conectarse para pruebas.

## Conectar un modelo propio

El modelo se configura únicamente en el servidor, mediante un módulo Python local
de confianza. No se suben archivos pickle desde la interfaz. El entorno Python que
ejecuta el backend debe contener las bibliotecas que necesita el modelo.

```python
# mi_modelo.py, importable desde la raíz del proyecto
def predict(window, sample_rate):
    # window: numpy.ndarray (muestras, canales), de la más antigua a la reciente.
    # Aplicar aquí el mismo preprocesamiento y orden de canales del entrenamiento.
    # Sustituir la línea siguiente por inferencia real.
    return {"angles": [0, 0, 0, 0, 0], "gesture": "continuous", "confidence": None}
```

```powershell
$env:EMG_MODEL_MODULE = "mi_modelo"
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Seleccionar `custom` en el cliente. Para regresión continua, devolver cinco `angles`
en el orden **pulgar, índice, medio, anular, meñique**, en grados entre 0 y 90.
`gesture="continuous"` es solo una etiqueta de compatibilidad del protocolo: no se
clasifican gestos ni se seleccionan poses predefinidas. `confidence` puede ser `null`;
no corresponde inventar una probabilidad para un regresor. Se rechazan salidas no
finitas o fuera de rango. `backend.example_model` devuelve una pose fija únicamente
para demostrar la firma del adaptador; no es un modelo entrenado.

El adaptador genérico conserva compatibilidad con salidas que contienen solo
`gesture` (`open`, `fist` o `pinch`), pero esa posibilidad no se usa en las plantillas
de regresión ni representa el objetivo de estimación continua de la tesis.

La inferencia usa un hilo de trabajo; el adaptador debe retornar en tiempo acotado.
Cancelar la conexión cierra el puerto, pero Python no puede interrumpir una llamada
de modelo que ya está ejecutándose en ese hilo. Evitar ejecutar varias sesiones con
un modelo con estado global que no soporte concurrencia.

Un módulo puede definir opcionalmente `prepare()` sin argumentos. El servicio la
ejecuta en un hilo antes de abrir el puerto serie para cargar sus pesos. Las plantillas
incluidas implementan esa función y mantienen una caché del modelo. No se llama a
`predict` con datos ficticios para calentar un modelo con estado. Si el primer forward
aún necesita compilación y excede el salto, la protección lo informa como sobrecarga.

### Plantillas TensorFlow/Keras y PyTorch

Se incluyen plantillas de **regresión continua de cinco flexiones**, con carga
diferida y caché del modelo:

- `backend.adapters.tensorflow_model`: archivo Keras `.keras` o `.h5`, una entrada
  y una salida tensorial. Los modelos con capas personalizadas requieren adaptar
  la carga y aportar sus definiciones. No admite SavedModel directamente.
- `backend.adapters.torchscript_model`: archivo `.pt` **exportado como TorchScript**,
  ejecutado en CPU y modo evaluación. No admite un `state_dict` ni cualquier archivo
  creado con `torch.save` solo por tener extensión `.pt`.

Los frameworks no se instalaron con las dependencias básicas. Instalar únicamente
el necesario, en una versión compatible con el artefacto entrenado:

```powershell
python -m pip install -r backend/adapters/requirements-tensorflow.txt
# O para TorchScript:
python -m pip install -r backend/adapters/requirements-torch.txt
```

Ejemplo para Keras:

```powershell
$env:EMG_MODEL_MODULE = "backend.adapters.tensorflow_model"
$env:EMG_MODEL_PATH = "C:\ruta\modelo.keras"
$env:EMG_EXPECTED_SAMPLES = "200"
$env:EMG_OUTPUT_UNITS = "degrees"
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Para TorchScript cambiar el módulo por `backend.adapters.torchscript_model`, indicar
el archivo `.pt` y mantener las otras variables acordes al entrenamiento. No hay
listas de clases, selección de gestos, logits ni probabilidades en estas plantillas.

La entrada esperada es `float32` con forma **NTC = (1, EMG_EXPECTED_SAMPLES, 8)**.
`EMG_EXPECTED_SAMPLES` es obligatorio y debe coincidir con el número de muestras
usado al entrenar. El ejemplo de 200 es solo ilustrativo: a 1000 muestras/s representa
una ventana de 200 ms. Ajustar frecuencia y ventana en la interfaz para que coincidan;
el adaptador rechaza dimensiones distintas. La función
`preprocess_window` de `backend/adapters/common.py` solo convierte tipo y agrega el
eje de lote. **Reemplazarla por el preprocesamiento del entrenamiento** antes de
evaluar modelos: unidades, offset, filtros, normalización, orden de canales, tamaño
de ventana y frecuencia. Un modelo que espere NCT, imágenes o características
necesita un adaptador acorde; estas plantillas no adivinan esa transformación.

La salida debe tener forma `(1, 5)` y conservar exactamente el orden **pulgar, índice,
medio, anular, meñique**. `EMG_OUTPUT_UNITS` es obligatorio:

- `degrees`: cada salida es un ángulo continuo entre 0 y 90 grados, sin modificación.
- `normalized`: cada salida debe estar entre 0 y 1 y se multiplica por 90. Usar esta
  opción únicamente si esa normalización corresponde a los objetivos del entrenamiento.

Se rechazan valores fuera de rango, infinitos y NaN, **sin recortarlos**. El resultado
es `{"angles":[...],"gesture":"continuous","confidence":null}`. Por ejemplo,
`[0, 0.1, 0.5, 0.75, 1]` normalizado produce `[0, 9, 45, 67.5, 90]` grados.

Este contrato controla una flexión agregada por dedo. No representa la posición
cartesiana exacta, abducción ni todos los ángulos MCP/PIP/DIP de una mano. Si los
objetivos del modelo son coordenadas, más articulaciones u otros rangos angulares,
se debe ampliar el contrato del adaptador y el modelo cinemático del visor antes
de evaluar esa correspondencia. Tampoco prueba precisión por sí solo: se requiere
comparación con posiciones de referencia sincronizadas.

Usar únicamente archivos locales de confianza: los modelos serializados pueden
contener componentes ejecutables. Las plantillas no cargan archivos desde la web o
la interfaz. Reiniciar el servidor si cambia el contenido de un modelo ya cargado.
Las dependencias opcionales y la inferencia con los modelos reales requieren
verificación en el entorno del proyecto; las pruebas básicas cubren el contrato
independiente del framework, no la precisión de un modelo entrenado.

## Verificación

```powershell
python -m unittest discover -s backend -v
```

Las pruebas cubren formato de muestras, características por canal, ventanas y saltos,
límites del adaptador, contrato de trama y cierre del puerto al cancelar mediante
un doble de prueba, conservación de las 15 000 muestras de un flujo de ocho canales
y contratos de forma/salidas de los adaptadores. No reemplazan la validación con hardware ni un experimento
de precisión, latencia o generalización con datos etiquetados.
