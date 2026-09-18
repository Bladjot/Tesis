# Ficha del piloto sEMG-MANUS

Preparación para entrenamiento en otro equipo con GPU, conservando los archivos en el proyecto. Esta ficha describe el diseño del piloto; no acredita que se haya entrenado o evaluado un modelo. Los recuentos efectivamente preparados, exclusiones, huellas y parámetros quedan en `datasets/semg_manus/prepared_v2/manifest.json`.

## Objetivo y alcance

Regresión continua de **ocho canales sEMG a veinte salidas nativas del guante MANUS**. Los nombres de tarea organizan los ensayos; no son clases que el modelo deba predecir. Se conserva el orden original de las veinte salidas para evitar asignaciones anatómicas prematuras.

El objetivo inicial es comprobar aprendizaje y generalización entre participantes del dataset. El resultado no demuestra todavía que el EMG PRO del usuario reproduzca posiciones exactas, ni valida el sistema como instrumento de medición anatómica. El simulador actual requerirá su propia adaptación de articulaciones, ejes y límites antes de recibir estas veinte salidas.

## Procedencia y licencia

- Dataset: **sEMG-MANUS**, Max Graf y Mathieu Barthet, publicado el 27 de marzo de 2026.
- Registro fijado: [Zenodo 19261324](https://zenodo.org/records/19261324), DOI `10.5281/zenodo.19261324`.
- Licencia de datos: **CC BY 4.0**. Conservar atribución, enlace a la licencia e indicar transformaciones al compartir datos preparados.
- Documentación original: `README.md`, `CODEBOOK.md`, `DATA_QUALITY.md`, manifiesto y licencia del depósito. La descarga debe conservar estas fuentes junto a los archivos de datos.
- El depósito publica 18 participantes y 3.108 CSV. La cohorte recomendada comprende `u_3`–`u_16` y `u_18`: quince participantes y 2.969 ensayos. Se excluyen `u_1`, `u_2` y `u_17`, incompletos.

Estos recuentos son los documentados por los autores, no el resultado de una ejecución de entrenamiento. Fuente: [codebook y notas de calidad del depósito](https://zenodo.org/records/19261324).

## Qué se mide

La adquisición combina un brazalete **Myo** de ocho canales con un **MANUS Quantum Metaglove**. Los CSV de la cohorte utilizada tienen 42 columnas: ocho EMG, diez IMU, veinte valores articulares y cuatro componentes de orientación de muñeca. Este piloto sólo utiliza las ocho EMG y las veinte salidas articulares; descarta IMU y cuaterniones como entradas para mantener compatibilidad dimensional con el brazalete del usuario.

El Quantum mide posiciones de puntas y reconstruye el esqueleto con un modelo biomecánico. Las veinte salidas no equivalen a veinte goniómetros independientes. El fabricante describe su ergonomía en grados, pero el dataset no cierra completamente la versión del exportador, la calibración ni los ejes de todas las columnas. Por ello, las métricas del piloto se interpretan en **unidades nativas de MANUS**, sin convertir una cifra de error en una garantía de exactitud anatómica. [Fabricante](https://www.manus-meta.com/products/quantum-metagloves), [semántica de ergonomía](https://docs.manus-meta.com/3.2.0/Software/Rec/Ergonomics/).

El orden de objetivos, con índices Python 0–19, es:

| Índices | Dedo | Nombres originales |
|---|---|---|
| 0–3 | Pulgar | `thumb_spread`, `thumb_mcp`, `thumb_pip`, `thumb_dip` |
| 4–7 | Índice | `index_spread`, `index_mcp`, `index_pip`, `index_dip` |
| 8–11 | Medio | `middle_spread`, `middle_mcp`, `middle_pip`, `middle_dip` |
| 12–15 | Anular | `ring_spread`, `ring_mcp`, `ring_pip`, `ring_dip` |
| 16–19 | Meñique | `pinky_spread`, `pinky_mcp`, `pinky_pip`, `pinky_dip` |

**Pulgar:** los nombres `pip` y `dip` son etiquetas genéricas del CSV; no describen su anatomía. La correspondencia probable con ergonomía MANUS es CMC separación, CMC flexión radial, MCP flexión e IP flexión, pero sigue pendiente confirmar la versión exacta del exportador. Se conservan los nombres originales en datos y resultados. No se reduce automáticamente a quince ángulos ni se recorta a 0–90°.

## Temporización y ventanas

- Frecuencia EMG **nominal**: 200 Hz, según el programa de adquisición consultado. El CSV no conserva timestamps por fila; no se pueden certificar jitter, frecuencia efectiva ni demora de sincronización.
- Los 120 Hz anunciados para el guante son una especificación de hardware, no una frecuencia del dataset verificada.
- El programa consultado empareja cada EMG con el guante de tiempo de recepción más próximo y elimina los tiempos al guardar. No está demostrada su identidad exacta con la versión usada en 2024.
- Entrada: ventana de **80 filas EMG**, aproximadamente 400 ms nominales, con salto de **10 filas** (50 ms nominales). El objetivo corresponde a la última fila de la ventana. Se usan EMG presente/pasada; ninguna ventana debe cruzar el límite de una grabación o de una partición.
- No se añade filtrado acausal ni un desfase temporal arbitrario. Tampoco se hereda el desfase aproximado de otro dataset, como EMG-FK.
- La primera inferencia con ventana completa requiere acumular ochenta filas. Ese contexto no equivale por sí solo a una medición de latencia total: deben medirse transporte, procesamiento e inferencia en el dispositivo real.

Fuentes de adquisición: [constantes](https://github.com/maxgraf96/sEMG-manus-manager/blob/main/constants.py), [captura Myo](https://github.com/maxgraf96/sEMG-manus-manager/blob/main/myo/worker_myo.py), [emparejamiento y exportación](https://github.com/maxgraf96/sEMG-manus-manager/blob/main/components/gesture_detail.py). La ausencia de filtros adicionales en este piloto no significa que la señal Myo original carezca de filtrado del dispositivo.

## Particiones y prevención de fugas

Partición fija por participante, semilla de diseño 42:

| Partición | Participantes | Uso |
|---|---|---|
| Entrenamiento | 5, 6, 8, 9, 10, 11, 12, 15, 16, 18 | Ajustar parámetros y normalización |
| Validación | 7, 14 | Seleccionar época y opciones de entrenamiento |
| Prueba | 3, 4, 13 | Evaluación final separada |

Todas las sesiones, tareas y velocidades de una persona quedan en la misma partición. La asignación ocurre **antes de construir ventanas**. Los estadísticos de normalización se calculan exclusivamente con entrenamiento y se reutilizan en validación, prueba y exportación. No se ajusta la escala con una grabación completa de prueba ni con sus ventanas futuras.

La evaluación por sujetos nuevos es exigente, pero sólo contiene tres personas en prueba; no permite una estimación definitiva de generalización a toda la población. Los autores describen participantes diestros y variabilidad entre sesiones. No existe una partición personalizada del nuevo usuario dentro de este primer piloto.

## Calidad y tratamiento

La inspección de los archivos descargados encontró **61 CSV antiguos de 38 columnas sin encabezado**, pertenecientes a `u_1` y `u_2`, ya excluidos por la definición de cohorte. No se les asigna el esquema de 42 columnas. Se conservan intactos y se verifica su SHA-256; su auditoría registra anchura, presencia de encabezado y cualquier diferencia frente al recuento del manifiesto original. La cohorte utilizada mantiene la comprobación estricta de 42 columnas y de los nombres y orden de las entradas y objetivos.

Los autores documentan dos grupos con dos ensayos y uno con cuatro en lugar de tres: `u_7/s_1/g_thumbs_up`, `u_8/s_1/g_tap_middle` y `u_9/s_2/g_tap_pinky`. No se generan grabaciones para equilibrarlos ni se duplica una ausente. El manifiesto preparado debe indicar explícitamente los ensayos incluidos/excluidos y el motivo; los recuentos reales tienen prioridad sobre duraciones supuestas.

Antes de entrenar se deben verificar esquema, forma, integridad del origen, valores finitos y separación de sujetos/ensayos. Los rangos negativos o superiores a 90 en objetivos no se consideran automáticamente errores: pueden reflejar convenciones del guante. No deben ocultarse con recortes arbitrarios.

Una auditoría previa de un ensayo de `u_3` encontró 2.020 filas × 42 columnas sin NaN/inf y un 69,1% de pares adyacentes con idénticas veinte salidas. Es evidencia de repetición de etiquetas en esa muestra; **no demuestra pérdida de paquetes ni mide la frecuencia real del guante**. La preparación completa tiene que producir sus propios recuentos y controles.

La auditoría completa encontró **50 ensayos con las veinte salidas exactamente constantes durante toda la grabación**, aunque varían los ocho canales EMG. Entre ellos, 22 ensayos de `u_13/s_2` comparten un mismo vector en ocho tareas distintas, y 17 de `u_8/s_3` comparten otro en siete tareas. Esto sugiere una referencia del guante congelada; no confirma por sí solo un fallo de hardware. La preparación `prepared_v2` excluye las 50 grabaciones mediante una regla idéntica para entrenamiento, validación y prueba, fijada antes de entrenar. Se conservan los originales, la preparación inicial `prepared_v1` y el detalle en `training/manus/reports/constant_targets_review.json`. No se excluyen segmentos breves de postura estática dentro de ensayos con movimiento.

Tras esta exclusión quedan **2.919 ensayos y 5.767.720 filas**, con los mismos quince participantes. La normalización se vuelve a calcular sólo con las filas de entrenamiento aceptadas. El total de exclusiones es 189: 139 fuera de la cohorte completa y 50 por ausencia total de variación de los objetivos. Es una decisión conservadora de calidad de referencia para el piloto, no una selección basada en errores del modelo.

## Entrenamiento y evaluación previstos

El notebook opcional `entrenamiento_en_otra_pc.ipynb` está destinado al otro equipo. Usa el mismo proyecto, comprueba CUDA antes de iniciar entrenamiento y no instala dependencias ni descarga datos. La configuración inicial es 40 épocas y batch de 256, con selección de la mejor época por validación. Entrenamiento y evaluación de prueba son celdas distintas. El README describe los comandos equivalentes para quien prefiera la terminal. Los datos se pueden reconstruir con los scripts de descarga y preparación; no deben incluirse en el futuro repositorio Git junto con los archivos grandes de entrenamiento.

Reportar MAE y RMSE por canal en unidades nativas, además del agregado, conservando orden de salidas, partición, configuración y normalizador. Conviene analizar errores por persona, tarea y velocidad cuando la evaluación los proporcione. Reservar prueba para la decisión final: reutilizarla para escoger hiperparámetros convertiría sus resultados en validación.

## Transferencia pendiente al EMG PRO

Antes de conectar un modelo entrenado al sensor propio faltará:

1. Confirmar frecuencia efectiva, escala, filtrado, orden y ubicación de los ocho electrodos, además del protocolo COM y pérdidas.
2. Mantener el mismo historial causal y normalizador; adaptar frecuencia con un procedimiento documentado si difiere de la nominal del piloto.
3. Evaluar con datos del propio usuario y dispositivo, idealmente con referencia sincronizada de guante. Ocho canales iguales en cantidad no garantizan que la distribución de señales sea equivalente.
4. Resolver unidades, ejes y pulgar antes del mapeo al simulador; separar errores de predicción de límites y contactos del modelo mecánico.
5. Medir respuesta y estabilidad en línea. Una métrica offline favorable no basta para afirmar control continuo preciso.

No se exige completar estas etapas para entrenar el piloto remoto; sí para interpretar correctamente su transferencia al sistema final.
