# MyoHand · laboratorio local de simulación EMG

Prototipo funcional para una tesis de **regresión continua del movimiento de la mano
a partir de EMG**, con un modo Expo adicional para entrenar clasificadores de gestos
personalizados. Interfaz en español y representación 3D procedural; adquisición,
entrenamiento e inferencia locales.

## Inicio en Windows

Requiere Python 3.10+ y Node.js 22.12+.

Para continuar en otro equipo, clonar el repositorio y entrar al proyecto:

~~~powershell
git clone https://github.com/Bladjot/Tesis.git
cd Tesis
~~~

Los datasets, entornos virtuales y descargas de fuentes externas no se incluyen
en Git. El simulador funciona con su generador de demostración; la guía de
`training/manus/` explica cómo reconstruir los datos para entrenar.

~~~powershell
./iniciar.ps1
~~~

El script crea .venv, instala dependencias, compila la interfaz y deja el servidor
activo. Abre **http://127.0.0.1:8765** en Chrome o Edge. Detén el servidor con Ctrl+C.
No necesita sensores ni modelos para probar la demostración. La primera instalación
requiere internet; las fuentes, la mano y los recursos compilados son locales.

Si PowerShell bloquea scripts en esta sesión, ejecuta los pasos equivalentes:

~~~powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
./.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
~~~

## Qué está implementado

- Prótesis 3D con carcasas blancas, articulaciones mecánicas oscuras y cinco valores
  continuos de flexión: pulgar, índice, medio, anular y meñique. Cámara orbital,
  vistas, ampliación del visor, malla, estructura esquemática y ejes.
- Modo manual y control de la mano mediante la salida continua del procesamiento.
- Adquisición de ocho canales; generador sintético y conector a puertos COM.
- Ventanas y saltos configurables, RMS/MAV por canal, gráfica simultánea de ocho
  canales con visibilidad individual y tiempo de procesamiento medido.
- Registro de señal cruda, resultados por ventana y configuración; exportaciones
  CSV/JSON. Hasta 120.000 muestras por sesión en memoria del navegador.
- Contrato Python y plantillas de regresión TensorFlow/Keras y PyTorch/TorchScript.
- Asistente Expo que guía la apertura y el cierre de la mano 3D, captura ventanas
  etiquetadas, entrena un Random Forest local y permite usarlo inmediatamente en el
  simulador.

El controlador RMS incluido es una **referencia proporcional de demostración**,
no un modelo entrenado. La regresión continua sigue siendo el objetivo principal de
la tesis; el clasificador discreto del modo Expo es un flujo separado para demostrar
entrenamiento personalizado y control en tiempo real.

## Probar el flujo completo

1. Abre el simulador y mueve los controles de cada dedo.
2. Mantén “Generador de demostración” e inicia la adquisición.
3. Selecciona “Señal EMG” para que los valores calculados controlen la mano.
4. Activa o desactiva CH1–CH8 para comparar los canales en una misma gráfica.
5. Pulsa “Grabar”, espera unos segundos y detén el registro.
6. En “Sesiones”, descarga señal cruda, inferencias y metadatos.

Para inspeccionar detalles de la prótesis, usa el botón de ampliar junto a las
vistas de cámara. Arrastra para rotar y usa la rueda para acercar. Escape regresa
al laboratorio. La apariencia mecánica se inspira en la segunda referencia visual;
no representa dimensiones ni un diseño de fabricación validado.

## Conectar tu brazalete EMG PRO

El receptor USB CH340 del brazalete de ocho canales fue comprobado en `COM3` a
115200 baudios. El lector detecta automáticamente el flujo binario observado:
paquetes de 98 bytes con cabecera `55 AA AA 5F`, 10 muestras intercaladas de ocho
canales y bytes de cabecera/control. Cada muestra ADC de 8 bits se centra y escala
con `(valor - 127,5) / 127,5` antes de entrar al procesamiento.

El lector actual admite una muestra simultánea de los ocho canales por línea:

~~~text
0.01,-0.02,0.03,0.04,-0.05,0.06,0.07,-0.08
~~~

También admite JSON por línea:

~~~json
{"values":[0.01,-0.02,0.03,0.04,-0.05,0.06,0.07,-0.08]}
~~~

La estructura binaria se obtuvo de una captura del dispositivo real, no de una
especificación del fabricante. La frecuencia declarada de 1000 Hz todavía debe
validarse contra documentación o una medición independiente. Si otra versión del
firmware cambia cabecera, longitud, orden de canales o resolución ADC, habrá que
actualizar el decodificador. No se envían comandos ni se cambia el firmware.

## Entrenamiento personalizado para Expo

El botón **Expo** abre un panel lateral que mantiene visible la mano 3D. La primera
ronda registra la mano abierta durante 10 segundos y el puño cerrado durante otros
10 segundos. Después, la mano 3D alterna apertura y cierre durante 10 segundos para
capturar el movimiento repetido. Se descartan 250 ms alrededor de cada cambio. La
persona debe conservar la posición del brazo y del brazalete durante toda la secuencia,
que dura aproximadamente 37 segundos incluyendo las preparaciones.

Al terminar, el backend separa temporalmente ventanas de entrenamiento y validación,
entrena un Random Forest y guarda el artefacto en `artifacts/expo_models/`. Esa carpeta
es local y está excluida de Git. El modelo aparece en **Configurar adquisición →
Modelo activo** y también puede activarse directamente desde el resultado del asistente.
Sus dos clases controlan la mano abierta y el puño cerrado; se muestra la confianza de
la clasificación. La validación de una sesión sirve como diagnóstico de la demostración,
no como métrica clínica ni como sustituto de una evaluación con participantes separados.

## Integrar TensorFlow o PyTorch

El contrato base del adaptador:

~~~python
def predict(window, sample_rate):
    # window: NumPy (muestras, canales), sin filtrado ni normalización.
    # Ejecuta el mismo preprocesamiento y modelo que usaste al entrenar.
    return {
        "angles": [12.4, 35.8, 21.2, 19.5, 28.0],
        "gesture": "continuous",
        "confidence": None,
    }
~~~

Los cinco ángulos están en grados entre 0 y 90. El campo gesture es una etiqueta
interna del contrato; no requiere un clasificador.

Las plantillas en backend/adapters reciben (batch, tiempo, canales). Debes
ajustarlas si tu red usa otro orden, características en vez de señal cruda, otra
ventana, filtros o escaladores. Consulta su README para comandos y dependencias.
Instálalas en **el mismo entorno Python que ejecuta el servidor**. Un archivo
PyTorch de pesos/state_dict requiere la arquitectura original; la plantilla
incluida utiliza TorchScript.

## Primer modelo con sEMG-MANUS

El experimento de regresión de ocho canales EMG a veinte salidas del guante está
en [training/manus/README.md](training/manus/README.md). Incluye descarga verificada,
preparación con participantes separados, una TCN en PyTorch y un notebook para
continuar en otra PC con GPU. No se ha ejecutado entrenamiento en este equipo.

Los datos originales y preparados están en `datasets/semg_manus/`, excluidos de
Git. Al trasladar el proyecto, copiar esa carpeta o reconstruirla con los scripts
documentados. El modelo previsto entrega veinte valores nativos MANUS y requiere
un mapeo explícito antes de usarlo con los cinco controles actuales del simulador.

## Alcance científico

- Son **cinco controles de flexión**, con articulaciones acopladas por dedo; no
  representa todos los grados de libertad independientes de una mano humana.
- La posición exacta no se obtiene automáticamente de la amplitud EMG. Requiere un
  modelo entrenado y validado con referencias de posición/ángulo.
- La mano comprueba el contacto rígido entre palma, muñeca y dedos con envolventes
  convexas de las piezas renderizadas (Rapier). El pulgar tiene un soporte fijo
  integrado en la palma, una base esférica de oposición (CMC), un metacarpiano
  y dos falanges con articulaciones MCP e IP. Su punta flexiona respecto al
  segmento anterior. Los otros cuatro dedos tienen soportes fijos de nudillo;
  ninguna raíz se sostiene solamente mediante un punto invisible de la escena.
  Las carcasas están rebajadas alrededor de las bisagras para permitir la flexión.
- El recorrido solicitado es 0–90 por dedo. Los cuatro dedos largos acoplan sus
  articulaciones a 0–84,6°, 0–99° y 0–61,2°; el pulgar combina oposición de la
  base, flexión MCP de 0–46,8° y flexión IP progresiva de 0–35°.
  La punta permanece extendida durante el primer 38 % del mando; después se
  flexiona con una curva suave. Así la oposición no pliega prematuramente la
  falange distal hacia abajo: en la postura Pinza su flexión relativa es ≈13,7°.
  Son parámetros del mecanismo virtual, no mediciones de una prótesis real.
- La trayectoria se comprueba con avances conservadores, una separación nominal
  de 0,004 unidades del modelo y velocidad máxima de 120 grados de control/s.
  Los saltos de inferencia y la reanudación de pestañas no teletransportan la mano.
  Los ensamblajes rígidos y las uniones de eje/bisagra tienen exclusiones locales.
- “Flexión solicitada” conserva la orden; “Flexión alcanzada” muestra el control
  realizado tras aplicar velocidad y contacto. No confundir estos controles
  acoplados con mediciones independientes de cada articulación.
- Es cinemática con restricciones de contacto. No se calculan fuerzas, fricción,
  deformaciones, dinámica muscular ni precisión clínica. Una simulación dinámica
  validada requiere dimensiones CAD, masas, materiales, actuadores y calibración.
- No se mide MAE, RMSE o correlación sin datos objetivo sincronizados.
- latency_ms mide características e inferencia; no incluye espera de ventana,
  adquisición, transporte, suavizado visual ni renderizado.
- Los tiempos se reconstruyen con el índice y la frecuencia declarada.
  No detectan pérdidas ni deriva del reloj del sensor.
- No se filtra ni normaliza automáticamente la entrada real. El preprocesamiento
  debe coincidir exactamente con el del entrenamiento.
- Se exportan muestras recibidas en ventanas completadas. Al parar puede quedar un
  salto parcial sin emitir. La gráfica reduce puntos para dibujar; la exportación no.
- Al iniciar una grabación se añade contexto previo suficiente para reproducir la
  primera inferencia; el JSON identifica cuántas muestras previas se incluyeron.
  El límite de registro se aplica sin cortar la entrada de la última inferencia.
- Las grabaciones permanecen en memoria de la pestaña; expórtalas antes de cerrarla.
  Las inferencias exportadas son salidas del modelo, no ángulos manuales ni posiciones
  suavizadas del dibujo.

## Desarrollo y verificación

~~~powershell
python -m unittest discover -s backend -v
cd frontend
npm run build
npm test
npm run dev
~~~

Vite usa http://127.0.0.1:5173 y redirige API/WebSocket al servicio Python en 8765.
Ejecuta el backend en otra terminal. Mantén ambos en la interfaz local; esta
aplicación no es un servicio público autenticado.

~~~text
backend/               Adquisición, ventanas, inferencia y pruebas
backend/adapters/      Plantillas de regresión TensorFlow y PyTorch
frontend/src/hand.ts   Escena, cámara y animación
frontend/src/hand-model.ts Geometría y ejes del mecanismo articulado
frontend/src/hand-contact.ts Recorrido continuo y contacto rígido
frontend/src/hand-posture.ts Búsqueda de recorridos con cesión de paso
frontend/src/hand-planner.worker.ts Planificación fuera del hilo de la interfaz
frontend/tests/        Pruebas de contacto y de la geometría real de la mano
frontend/src/main.ts   Interfaz, señal y registro
frontend/src/style.css Apariencia y adaptación a pantallas
iniciar.ps1            Inicio local en Windows
~~~

Las pruebas estructurales comprueban el desplazamiento del extremo visible y la
rotación relativa de cada falange distal, longitudes constantes de los segmentos
y una conexión de material continua entre palma, soportes, rodamientos y ejes.
La vista **Palma** permite observar directamente la oposición y la punta del pulgar.
En modo manual, tanto los deslizadores como las posturas predefinidas disponen
de coordinación automática. Ante un atasco, se identifican los dedos en contacto
y se buscan desplazamientos temporales que dejen pasar al resto. La ruta debe
alcanzar los cinco ángulos originales, incluidos los de los dedos que cedieron
el paso; los deslizadores conservan siempre esos objetivos. El cálculo se realiza
en un Worker para mantener disponible la interfaz. Durante el cálculo aparece
“Calculando qué dedo debe ceder el paso” y durante el recorrido, “Cediendo el paso”.
Cada tramo se valida y se ejecuta con las mismas restricciones de separación y
velocidad que el movimiento directo. La búsqueda es acotada: si no encuentra una
ruta libre, se informa del resultado y se conserva el límite de contacto.

Una nueva orden manual cancela y sustituye la ruta anterior. Al activar el modo
EMG se cancela la asistencia: la inferencia conserva su orden directa, sujeta
a los límites de contacto. Una señal real tampoco garantiza que la predicción
sea físicamente alcanzable. Las pruebas de coordinación cubren los 16 pares de
posturas, bloqueos de pulgar/índice, cambios de objetivo y cancelación, verificando
la separación de materiales, la velocidad y la recuperación de los objetivos.

Referencias de implementación: [Three.js](https://threejs.org/docs/),
[FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/) y
[pySerial](https://pyserial.readthedocs.io/en/latest/pyserial_api.html).
