# Lectura de la fuente EMG-FK

Consulta: 18 de septiembre de 2026. Código externo descargado para lectura; no se ejecutó ni se entrenó ningún modelo. Se consultó el repositorio que enlaza el registro aportado por el usuario.

- Registro: https://zenodo.org/records/19453843
- Repositorio: https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor
- Commit consultado: `514a5a23a4c77a23f5ad65ec480fad8c637d8e7b` (2026-04-28). El historial indica que la carga de código ocurrió el 2026-04-13; los commits posteriores añaden figuras, vídeos y enlaces.
- Preprint: https://arxiv.org/html/2604.22499v1

Los originales descargados están en esta carpeta. Los archivos `.ipynb.txt` contienen únicamente las celdas de texto/código concatenadas para facilitar su lectura. No contienen resultados generados localmente.

**Límite de procedencia del código:** el exportador publicado está incompleto: devuelve `accel` y `gyro` sin definirlos y configura sólo 23 canales (8 EMG + 15 Angle), mientras los FIF verificados contra Zenodo tienen 29 canales e incluyen seis auxiliares. No permite reproducir exactamente los archivos publicados. Los mapeos y la separación entre etiquetas y predicciones siguientes documentan la intención del código enlazado por los autores; el FIF no guarda por sí mismo esa correspondencia anatómica o el historial exacto de preprocesamiento.

## Correspondencia de canales

Orden de salida definido por `joint_names`, empleado por `get_mediapipe_angles`, y conservado por el exportador FIF:

| Canal FIF | Articulación del código | Interpretación |
| --- | --- | --- |
| Angle 1 | Thumb_CMC | Pulgar, carpometacarpiana |
| Angle 2 | Thumb_MCP | Pulgar, metacarpofalángica |
| Angle 3 | Thumb_IP | Pulgar, interfalángica |
| Angle 4 | Index_MCP | Índice, metacarpofalángica |
| Angle 5 | Index_PIP | Índice, interfalángica proximal |
| Angle 6 | Index_DIP | Índice, interfalángica distal |
| Angle 7 | Middle_MCP | Medio, metacarpofalángica |
| Angle 8 | Middle_PIP | Medio, interfalángica proximal |
| Angle 9 | Middle_DIP | Medio, interfalángica distal |
| Angle 10 | Ring_MCP | Anular, metacarpofalángica |
| Angle 11 | Ring_PIP | Anular, interfalángica proximal |
| Angle 12 | Ring_DIP | Anular, interfalángica distal |
| Angle 13 | Pinky_MCP | Meñique, metacarpofalángica |
| Angle 14 | Pinky_PIP | Meñique, interfalángica proximal |
| Angle 15 | Pinky_DIP | Meñique, interfalángica distal |

Evidencia: [mediapipe.py, L89–95 y L147–164](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/rbcx/handtracker/mediapipe.py#L89-L95), [exportador, L38–49](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/numpyToFif.py#L38-L49).

## Convención angular y límites de interpretación

La fórmula es el ángulo interior entre `a-b` y `c-b`, obtenido mediante arcocoseno y expresado en grados. Tres puntos alineados con la articulación central entre los otros dos producen aproximadamente 180°, no 0°. La transformación `180 - ángulo` representa el complemento respecto de esa rectitud geométrica; no calibra por sí sola una articulación anatómica o un eje del simulador.

El MCP de los cuatro dedos usa como referencia proximal el centro calculado de la palma. El CMC del pulgar usa muñeca–CMC–MCP. Los demás usan tripletas sucesivas de articulaciones. Por ello conviene conservar las etiquetas originales para entrenamiento/evaluación y aplicar una conversión explícita y calibrada al visualizar. No se registran abducción, oposición completa ni orientación global de la mano como salidas independientes.

Evidencia: [mediapipe.py, L377–425](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/rbcx/handtracker/mediapipe.py#L377-L425).

## Anotación «model trained»

El preprint describe 15 minutos de movimiento con feedback de cámara, una pausa aproximada de cinco minutos para entrenar y otros 15 minutos con feedback de predicciones EMG. El protocolo se realizó con mano derecha. La marca corresponde al entrenamiento/cambio de feedback, no a una partición obligatoria train/test. [Protocolo, sección II-B](https://arxiv.org/html/2604.22499v1#S2.SS2).

El código mantiene dos series separadas: `self.label` siempre recibe los ángulos MediaPipe, mientras `self.shownPred` almacena lo mostrado al participante. El exportador concatena EMG y etiquetas de cámara interpoladas; no incluye `shownPred`. Por tanto, el código publicado no respalda afirmar que los Angle posteriores a la marca sean predicciones del modelo.

Evidencia: [EMG_regression.py, L190–234](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/EMG_regression.py#L190-L234), [numpyToFif.py, L20–57](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/numpyToFif.py#L20-L57).

## Sincronización

Zenodo advierte un desfase aproximado de 300 ms entre EMG y cinemática; no debe asumirse corregido por tener ambos 500 Hz. El preprint estima la corrección por correlación entre una componente de movimiento EMG y velocidad articular, separando las mitades de la grabación. El notebook publicado utiliza cuatro segmentos (`CUT=4`), explora de −200 a +500 muestras, en pasos de cinco: −400 a +1000 ms, paso 10 ms. La corrección usa `label_sync[t]=label[t+shift]`, con saturación en los bordes. Un desfase positivo adelanta las etiquetas registradas respecto de EMG. No hay una resta fija universal de 150 muestras.

Fuentes: [Zenodo](https://zenodo.org/records/19453843), [preprint, II-C](https://arxiv.org/html/2604.22499v1#S2.SS3), [notebook intra-subject, celda sync, líneas JSON 231–258](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/experiments/Hand%20Gesture%20Regression%20from%20EMG%20-%20Benchmark%20-%20EMG-FK%20-%20intra-subject.ipynb#L231-L258).

Implicación metodológica: estimar la alineación sólo con entrenamiento/calibración si se pretende evaluar un flujo causal; documentar cualquier uso de etiquetas del conjunto de prueba para alineación. La interpolación a 500 Hz no equivale a 500 mediciones visuales independientes por segundo.

## Escala EMG y preprocesamiento

`EMG.py` obtiene datos del SDK MindRove, elimina la media por bloque con `detrend(CONSTANT)` y devuelve `data[:8]`. El exportador crea canales MNE de tipo `emg` y pasa los valores numéricos sin una conversión explícita a voltios. La documentación oficial MindRove distingue SDK ≥5.0.0 (microvoltios) de versiones anteriores (cuentas que se multiplican por 0.045 para obtener microvoltios). El repositorio no fija una versión SDK, por lo que no se puede resolver la unidad física sólo con el encabezado FIF. Usar «unidades almacenadas» hasta aclararlo; no aplicar automáticamente un factor suponiendo voltios o microvoltios.

Fuentes: [EMG.py](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/EMG.py#L17-L26), [exportador](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/numpyToFif.py#L38-L49), [unidades MindRove](https://docs.mindrove.com/main/DataFormatDesc.html#units-of-measure).

La descripción Zenodo indica ausencia de preprocesamiento, mientras el código de adquisición publicado incluye el detrend citado. Distinguir lo declarado en el registro de lo observado en el código, sin afirmar que cada FIF haya sido generado exactamente con esa revisión. Los notebooks de evaluación añaden filtros 15–150 Hz y notch de 50, 100 y 150 Hz; no equivalen a la adquisición sin filtros.

## Evaluación y adaptación a la tesis

El preprint describe validación intra-sujeto de diez bloques sin barajar y evaluación entre sujetos LOSO, reservando también un sujeto de validación. El notebook intra-sujeto usa `KFold(10, shuffle=False)`; sus ventanas se extraen antes del reparto. Esto no impone una separación temporal de seguridad entre ventanas vecinas de entrenamiento y prueba. El código entre sujetos estandariza usando la señal completa de cada participante; esa normalización debe distinguirse de un despliegue que sólo dispone de una calibración inicial y del pasado.

Hay diferencias entre ramas del notebook LOSO: las rutas CNN/vemg2pose separan un sujeto de validación, mientras la ruta MLP/RNN toma un bloque de 10% del conjunto concatenado de entrenamiento. Estas diferencias requieren documentar la implementación escogida si se reproduce el benchmark.

Fuentes: [preprint, II-F](https://arxiv.org/html/2604.22499v1#S2.SS6), [notebook intra-subject](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/experiments/Hand%20Gesture%20Regression%20from%20EMG%20-%20Benchmark%20-%20EMG-FK%20-%20intra-subject.ipynb), [notebook cross-subject](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/experiments/Hand%20Gesture%20Regression%20from%20EMG%20-%20Benchmark%20-%20EMG-FK-%20cross-subject.ipynb).

Para un experimento propio: conservar sujetos de prueba completos, ajustar normalizadores sólo con entrenamiento/calibración, separar ventanas por su soporte temporal total y tratar discontinuidades/cambio de fase explícitamente. El uso del sensor EMG PRO del usuario requiere verificar frecuencia, escala, orden y ubicación de canales; compartir ocho canales no demuestra equivalencia con MindRove.
