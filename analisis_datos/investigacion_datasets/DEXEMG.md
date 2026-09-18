# DexEMG — referencia metodológica, acceso a datos no confirmado

Consulta: 18 de septiembre de 2026.

**Dictamen:** se parece mucho al objetivo del proyecto por combinar un brazalete de ocho canales y un guante, pero no debe presentarse como dataset público disponible para entrenar. No se encontró una descarga oficial verificable ni licencia de datos.

## Evidencia primaria

El preprint de marzo de 2026 describe gForce de ocho canales en antebrazo y un guante Manus MoCap que entrega 35 puntos del esqueleto. Las etiquetas finales son 22 ángulos de la mano robótica Sharpa Wave, obtenidos mediante optimización de puntos y corrección de autocolisiones; no constituyen quince ángulos anatómicos humanos medidos directamente.

El artículo no especifica frecuencias de adquisición, modelo exacto del guante, procedimiento de calibración del guante, número de participantes, duración ni tamaño del corpus. Tampoco detalla el error de sincronización ni separa articulaciones medidas de las reconstruidas por el software Manus. Su ventana de 400 pasos no permite calcular milisegundos sin conocer la frecuencia.

La sección de limitaciones reconoce calibración individual para nuevos usuarios. Por ello, la generalización mostrada a objetos y escenarios nuevos no acredita transferencia directa a personas nuevas o al EMG PRO.

Fuente: [DexEMG, texto original completo, secciones III–V](https://arxiv.org/html/2603.05861v1). [Ficha y versión arXiv](https://arxiv.org/abs/2603.05861).

## Comprobación de disponibilidad

- El texto original y su ficha no enlazan una publicación del dataset ni un repositorio de entrenamiento.
- Se hicieron búsquedas por nombre exacto junto con `dataset`, `download`, `github`, `Hz`, `participants` y los autores. No se identificó un registro público oficial con archivos de señales.
- [MANUS incluye DexEMG en su página de investigación](https://www.manus-meta.com/research), pero esa referencia enlaza el artículo y no acredita una liberación de datos.
- La licencia de publicación de arXiv que aparece en la ficha es una licencia de distribución del artículo; **no es una licencia de reutilización de un corpus de señales**.
- No se descargaron datos ni se contactó a los autores.

## Consecuencia para la tesis

Serviría para discutir una arquitectura de control y el ajuste cinemático entre mano humana y robótica. Para elegirlo como base de entrenamiento habría que obtener un acceso verificable, licencia, protocolo y señales humanas originales sincronizadas. Incluso si se compartieran las etiquetas robóticas finales, su transformación podría ocultar parte del movimiento humano y condicionar la evaluación de precisión anatómica.

No se asigna una frecuencia típica de gForce o Manus por inferencia: el artículo no identifica suficientemente la configuración empleada. Tampoco se supone que EMG PRO y gForce sean el mismo dispositivo porque ambos tengan ocho canales.
