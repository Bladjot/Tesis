# Análisis de Datos-Train

Revisión realizada el 18 de septiembre de 2026. **El conjunto es pertinente para entrenar regresión continua de EMG a ángulos de los dedos.** Contiene señales de entrada y referencias angulares variables en el tiempo. Todavía requiere preparación y adaptación al simulador; esta revisión no entrena un modelo ni demuestra su precisión sobre el brazalete EMG PRO.

Se leyeron todos los valores de los 20 FIF, se inspeccionaron sus metadatos y se compararon tamaño y MD5 con el manifiesto oficial: **20 de 20 archivos coinciden exactamente con Zenodo**. Los datos originales no se modificaron. La fuente es [EMG-Finger-Kinematics, EMG-FK](https://zenodo.org/records/19453843).

| Medida comprobada localmente | Resultado |
|---|---:|
| Archivos / participantes documentados | 20 |
| Tamaño total | 2.108.217.483 bytes, aproximadamente 2,11 GB |
| Duración acumulada | 10,094 horas |
| Duración por archivo | 30,08–30,93 minutos |
| Frecuencia declarada, uniforme | 500 Hz |
| Instantes de muestreo acumulados | 18.168.617 |
| Canales por archivo, mismo orden | 29 |
| NaN o infinitos en los datos leídos | 0 |
| Canales completamente constantes | 0 |
| Archivos idénticos por SHA-256 | 0 pares |

Cada archivo contiene **8 EMG + 3 giroscopio + 3 acelerómetro + 15 Angle**. Los 18 millones de instantes no son 18 millones de ejemplos independientes: hay dependencia temporal y los ángulos visuales fueron interpolados. Según el registro, el EMG se adquirió con MindRove y las referencias mediante MediaPipe. Compartir ocho canales con el EMG PRO no garantiza equivalencia de colocación, escala o respuesta del sensor. [Descripción del conjunto](https://zenodo.org/records/19453843).

**Qué representan los ángulos.** El orden documentado en el código enlazado por los autores es:

| Canales | Dedo | Articulaciones, en ese orden |
|---|---|---|
| Angle 1–3 | Pulgar | CMC, MCP, IP |
| Angle 4–6 | Índice | MCP, PIP, DIP |
| Angle 7–9 | Medio | MCP, PIP, DIP |
| Angle 10–12 | Anular | MCP, PIP, DIP |
| Angle 13–15 | Meñique | MCP, PIP, DIP |

CMC: base del pulgar; MCP: nudillo; PIP/DIP: articulaciones intermedias y distales; IP: articulación distal del pulgar. El código calcula **ángulos interiores geométricos en grados**, con rectitud próxima a 180°. El rango observado en todos los archivos fue 0,56–179,98°. Por tanto, no deben enviarse directamente a los controles actuales de 0–90°. El complemento `180 − ángulo` puede servir como representación de flexión geométrica, pero requiere calibración por articulación para el mecanismo virtual, especialmente en CMC/MCP. [Orden y fórmula en el código publicado](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/rbcx/handtracker/mediapipe.py#L377-L425).

Estas referencias proceden de visión; no son mediciones directas con un guante articular. Los FIF no incorporan confianza de seguimiento, coordenadas de la mano ni todas sus rotaciones independientes. Se conservan las etiquetas originales al evaluar; la calibración del visor debe estar documentada aparte.

**Sincronización.** Los autores advierten un desfase aproximado de **300 ms**, equivalente a unas **150 muestras a 500 Hz**, entre EMG y cinemática. Tener el mismo índice de muestra no demuestra alineación física. Es necesario estimar el sentido y magnitud del desplazamiento por registro/fase, retirar los bordes sin correspondencia y documentar qué datos se usaron para ajustarlo. No aplicar una resta fija de 150 muestras sin verificarla. El informe de fuentes detalla el procedimiento publicado y sus diferencias entre artículo y notebook. [Aviso del publicador](https://zenodo.org/records/19453843).

**Fases del registro.** Hay 19 anotaciones `model trained`; Subject_02 carece de ella. El protocolo describe una primera fase con feedback de cámara y una segunda con feedback del modelo EMG. El código mantiene etiquetas de cámara y predicciones mostradas en series distintas: la anotación no permite considerar los Angle posteriores como predicciones ni impone una partición obligatoria entrenamiento/prueba. [Protocolo](https://arxiv.org/html/2604.22499v1#S2.SS2), [registro separado de etiquetas y predicciones](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/EMG_regression.py#L190-L234).

En Subject_01, las muestras consecutivas con los 15 ángulos idénticos representan 38,06 % antes de la marca y 30,74 % después; el RMS EMG por canal aumenta entre 5,25 % y 12,88 %. Son diferencias observadas, no una explicación causal. Conviene conservar la fase como metadato y evaluar ambas por separado. No se debe inventar el instante equivalente de Subject_02 sólo porque los demás lo tienen cerca de la mitad.

**Calidad y escala.** La lectura numérica completa no mostró canales vacíos o no finitos. Esto no descarta artefactos de adquisición o errores de seguimiento. Se localizaron dos casos destacados:

| Archivo | Canal y tiempo del máximo absoluto | Valor almacenado | Instantes con algún EMG por encima de 10×su desviación estándar |
|---|---|---:|---:|
| Subject_07 | EMG 7, 1072,808 s | +29.398,68 | 0,160 % |
| Subject_20 | EMG 7, 113,416 s | −7.978,00 | 0,387 % |

Hay otros episodios altos en ambos registros. El umbral es exploratorio: no diagnostica clipping ni justifica descartar sujetos completos. Los intervalos y criterios exactos están en `revision_picos.json`.

El encabezado etiqueta EMG en voltios, pero el exportador enlazado no convierte explícitamente la escala del SDK. MindRove documenta escalas diferentes según versión, que el repositorio no fija. Por ello las gráficas muestran **valores almacenados**, sin asumir V o µV. También existe una diferencia entre la descripción «sin preprocesamiento» y el detrend por bloques del código publicado; no se puede establecer el historial exacto de cada FIF a partir de ese código. [Unidades del SDK](https://docs.mindrove.com/main/DataFormatDesc.html#units-of-measure), [adquisición publicada](https://github.com/ulb-mlg/Joint-Angles-Regression-from-EMG---Temporal-Riemannian-Regressor/blob/514a5a23a4c77a23f5ad65ec480fad8c637d8e7b/acquisitionFramework/EMG.py#L17-L26).

El exportador público declara 23 canales y contiene variables auxiliares sin definir, mientras los archivos verificados tienen 29. El código sirve como documentación de intención, pero esa revisión no reproduce exactamente los FIF. Esta discrepancia y las referencias precisas están desarrolladas en el informe de fuentes.

**Consecuencia para el simulador y el entrenamiento.** Los adaptadores actuales reciben ventanas `(1, N, 8)` y entregan sólo `(1, 5)`: un control por dedo, del que el visor deduce las demás articulaciones mediante reglas. Para aprovechar los 15 objetivos y evaluar cada articulación, conviene ampliar adaptadores y visor a 15 salidas independientes con una conversión angular calibrada. Reducir las etiquetas a cinco valores perdería información; no basta con promediar tres ángulos por dedo.

A 500 Hz, una ventana de 200 ms contiene 100 muestras, por lo que su entrada sería `(lote, 100, 8)`. Esa ventana es un ejemplo compatible con el formato actual, no una longitud óptima ya validada. Los modelos pueden necesitar más historia temporal. Giroscopio y acelerómetro son entradas opcionales para un experimento aparte; Angle debe permanecer como objetivo y no introducirse accidentalmente como entrada del modelo EMG.

Para la siguiente etapa propongo:

1. Fijar versión del conjunto, unidades, mapa angular y protocolo de alineación.
2. Separar sujetos de entrenamiento, validación y prueba antes de generar ventanas. Si se evalúa calibración individual, separar bloques temporales y dejar un margen que cubra toda la historia usada por el modelo. No sortear ventanas solapadas entre conjuntos.
3. Ajustar normalización, filtros y alineación sólo con entrenamiento/calibración; replicar el procesamiento causal que podrá ejecutarse con el brazalete. Conservar fases y revisar los picos señalados.
4. Entrenar una referencia sencilla y comparar TensorFlow/PyTorch usando MAE/RMSE en grados por articulación y sujeto, además de latencia. Evaluar predicciones originales y posiciones realmente ejecutadas por el visor como resultados distintos.
5. Validar transferencia con registros del EMG PRO: frecuencia real, escala, orden/ubicación de electrodos y referencia de movimiento propia. Las métricas de estos FIF no demuestran precisión sobre otro dispositivo o usuario.

Los originales permanecen en `Datos-Train`. En esta carpeta quedan la auditoría por archivo/canal, los hashes, scripts reproducibles, gráficas y la lectura del código fuente. No se ha entrenado ni seleccionado ningún modelo.

![Duración y amplitud por sujeto](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/resumen_dataset.png>)

![Ejemplo real de EMG y ángulos](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/ejemplo_senales.png>)

Documentación adicional: [lectura de las fuentes](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/fuentes/LECTURA_FUENTE_EMG_FK.md>), [resumen por archivo](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/resumen_archivos.csv>), [estadísticas por canal](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/estadisticas_canales.csv>).
