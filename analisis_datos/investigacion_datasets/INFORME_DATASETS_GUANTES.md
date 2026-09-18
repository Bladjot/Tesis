# Datasets para inferir movimiento continuo de la mano desde ocho canales EMG

Investigación realizada el **18 de septiembre de 2026** para la tesis y el simulador de mano del proyecto.

**Recomendación: iniciar un piloto con sEMG-MANUS y utilizar Ninapro DB5 + DB9 como comparación independiente.** El primero combina un brazalete de ocho canales y salidas continuas de un guante MANUS; el segundo permite trabajar con un Myo de ocho canales y un CyberGlove de 22 sensores, incluidos sensores distales. Ninguno acredita por sí solo la precisión angular ni la transferencia directa al EMG PRO. Para movimientos cotidianos añadiría KIN-MUS-UJI o MyoKi, aceptando que sus guantes no miden las cuatro articulaciones distales de los dedos largos.

La búsqueda se basó en artículos originales, documentación de fabricantes, repositorios de autores y depósitos oficiales. Además de leer documentación, se comprobaron archivos de dos candidatos. Es una investigación técnica dirigida; no una revisión sistemática exhaustiva de toda la literatura.

## Requisitos usados para seleccionar

El objetivo es **regresión continua EMG → ángulos articulares**, utilizable después con TensorFlow o PyTorch. No basta una etiqueta como «puño». Se priorizaron señales EMG y referencias angulares simultáneas, transiciones de movimiento, identificación de articulaciones/unidades, guantes instrumentados, temporización documentada y disponibilidad real de datos. Ocho canales y electrodos de antebrazo favorecen la cercanía al hardware del proyecto, pero no hacen equivalentes dos sensores.

Aquí MCP significa articulación del nudillo; PIP, articulación intermedia del dedo; DIP, articulación cercana a la punta. El pulgar tiene CMC, MCP e IP. La cantidad de sensores de un guante incluye con frecuencia separación de dedos, arco palmar y muñeca: **18 sensores no significa 15 flexiones medidas más tres extras**.

## Comparación de candidatos principales

| Dataset | EMG y participantes | Referencia de movimiento | Utilidad para esta tesis | Principal condición |
|---|---|---|---|---|
| **sEMG-MANUS, 2026** | Myo, 8 canales; 15 participantes principales de 18 publicados | MANUS Quantum; 20 salidas articulares | Primer piloto: mismas dimensiones de entrada, movimientos a varias velocidades, incluye salidas DIP | Reconstrucción biomecánica del guante; timestamps eliminados del CSV; cerrar semántica del pulgar |
| **Ninapro DB5 + DB9** | Dos Myo, 16 canales; usar un brazalete de 8; 10 participantes | CyberGlove II, 22 sensores; DB9 aporta ángulos calibrados | Comparación bien documentada; incluye sensores DIP | Guante nativo <25 Hz; calibración aproximada y problemas de ajuste; revisar valores extremos |
| **Ninapro DB2 + DB9** | Delsys, 12 canales; primeros 8 en antebrazo; 40 participantes | CyberGlove II, 22 sensores, calibrado en DB9 | Ampliar población manteniendo referencia con sensores distales | Diferente hardware; mismo límite temporal del guante |
| **KIN-MUS-UJI** | 7 canales; 22 participantes | CyberGlove, 18 ángulos calibrados; 26 actividades cotidianas | Alternativa pequeña y funcional; publica EMG crudo y procesado | No mide las cuatro DIP; siete sitios de medida no equivalen al brazalete |
| **MyoKi, 2025** | 12 Delsys, 8 de antebrazo; 35 participantes | CyberGlove de 18 sensores; 74 tareas | Diversidad de actividades y regresión de articulaciones medidas | Sin medición directa de las cuatro DIP; grados aproximados mediante calibración compartida; gran volumen |
| **PiMForce, 2024** | 8 Delsys; 21 participantes | MANUS Quantum, 20 salidas articulares y presión | Complemento para fuerza/pose; EMG de mayor frecuencia que Myo | Protocolo orientado a presión; no garantiza cobertura articular libre; licencia de datos no confirmada |

Fuentes primarias de la tabla: [sEMG-MANUS](https://zenodo.org/records/19261324), [DB5](https://ninapro.hevs.ch/instructions/DB5.html), [DB2](https://ninapro.hevs.ch/instructions/DB2.html), [calibración DB9](https://www.nature.com/articles/s41597-019-0349-2), [KIN-MUS-UJI](https://zenodo.org/records/3469380), [MyoKi](https://doi.org/10.1038/s41597-025-05852-6), [PiMForce](https://arxiv.org/abs/2410.23629).

## Por qué empezaría con sEMG-MANUS

Es el candidato que más directamente reúne el formato de entrada buscado y una referencia de guante con salidas para toda la mano. Las tareas incluyen flexión/extensión de dedos y no se limitan a mantener una postura. Aunque los archivos estén organizados por gestos, se puede entrenar contra cada trayectoria angular, ignorando la clase como objetivo. El ZIP ocupa unos 594 MB y su licencia es CC BY 4.0. [Depósito oficial](https://zenodo.org/records/19261324).

**Comprobación propia:** se extrajo un ensayo del participante 3 mediante lectura parcial del ZIP, transfiriendo sólo 574 kB. Tiene 2.020 × 42 valores, sin NaN/infinito, con cambios continuos de MCP/PIP/DIP. Se verificó el CRC de ese archivo. No se auditó todavía la calidad de toda la base.

El código actual consultado declara EMG a 200 Hz y asigna la postura con timestamp más cercano; luego descarta los timestamps. No se confirmó que sea exactamente la versión utilizada durante la captura de 2024. En la muestra, el 69,1% de las parejas de filas adyacentes repite las veinte salidas del guante. Esto impide interpretar las filas como medidas independientes a 200 Hz. No demuestra por sí solo pérdida de datos. [Captura y exportación del autor](https://github.com/maxgraf96/sEMG-manus-manager/blob/main/components/gesture_detail.py).

El Quantum mide las puntas y reconstruye el esqueleto mediante un modelo. Por eso disponer de una columna DIP no equivale a medir directamente esa articulación. El fabricante documenta ángulos de ergonomía en grados y una semántica especial del pulgar; habría que comprobarla en la versión utilizada antes de copiar las columnas al simulador. [Tecnología Quantum](https://www.manus-meta.com/products/quantum-metagloves), [semántica de ángulos](https://docs.manus-meta.com/3.2.0/Software/Rec/Ergonomics/).

![Muestra real EMG y trayectorias MANUS](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/investigacion_datasets/muestra_manus.png>)

La figura representa datos del guante, no una predicción entrenada. Su eje horizontal utiliza índices porque los CSV no conservan los tiempos originales.

## Por qué mantener Ninapro como comparación

DB5 solo contiene lecturas de guante sin calibrar. **Hay que combinar el EMG de DB5 con los ángulos de DB9**; DB9 por sí solo no contiene EMG. DB9 cubre los ejercicios B/C, no todos los movimientos de la base original. [Instrucciones DB9](https://ninapro.hevs.ch/instructions/DB9.html).

La correspondencia se comprobó realmente para DB5 sujeto 1 ↔ DB9 sujeto 68: ejercicios E2/E3, con 179.901 y 258.372 filas. El guante original y cuatro vectores de etiquetas/repeticiones coinciden exactamente. El resto de participantes debe verificarse antes de unir datos.

La auditoría también encontró salidas calibradas extremas entre −318,3 y 233,8° en esos registros. Se deben localizar por canal y segmento, no aceptarlas como rangos físicos ni ocultarlas con recortes indiscriminados. La publicación explica problemas de sensores y dependencia del tamaño de la mano, especialmente en DIP. Las lecturas a 200 Hz de DB5 o 2 kHz de DB2 proceden de un guante adquirido a menos de 25 Hz. [Descriptor de calibración](https://www.nature.com/articles/s41597-019-0349-2).

Así, si la prioridad principal es **sensores sobre las articulaciones distales**, DB5/DB2 + DB9 resulta especialmente relevante. Para un piloto compacto con ocho EMG y salidas continuas para toda la mano, probaría primero MANUS, conservando sus límites declarados.

## Actividades cotidianas y bases secundarias

**KIN-MUS-UJI:** sus 572 registros cubren alcanzar, manipular y soltar objetos. Publica `RAW_EMG.mat`, sin filtrar ni remuestrear, además del archivo de ángulos/actividad normalizada. No debe confundirse la envolvente procesada con la señal cruda. Los dos MAT suman aproximadamente 214,4 MB. Es atractivo para un segundo experimento con articulaciones realmente medidas, aunque no cubre todas las DIP. [Datos y esquema](https://zenodo.org/records/3469380).

**MyoKi:** el guante trabaja aproximadamente a 80,85 Hz; guante, IMU y FMG se alinean a 2 kHz mediante retención de muestras. Esa rejilla común no añade información angular. Publica grados aproximados con calibración de referencia basada en una mujer y un hombre, no calibración anatómica completa por participante. El EMG nativo se describe a 1259 Hz y se eleva internamente a 2 kHz; no se verificó que esa conversión use el mismo método de retención. Los 35 archivos principales suman 143,51 GB, calculados desde la API. Lo usaría después de un piloto, seleccionando únicamente los canales y articulaciones adecuados. [Descriptor](https://doi.org/10.1038/s41597-025-05852-6), [inventario Figshare](https://api.figshare.com/v2/articles/28696778).

**PiMForce:** registra presión y veinte salidas articulares con EMG a 2 kHz y MANUS a 120 Hz, posteriormente alineados. Las interacciones enfatizan aplicar/liberar fuerza contra superficies u objetos. Contiene señal angular continua, pero no acredita un barrido independiente de todas las articulaciones. Es más útil si la tesis también evalúa fuerza de agarre. No se debe trasladar la licencia MIT del código al dataset sin confirmación. [Artículo NeurIPS](https://papers.nips.cc/paper_files/paper/2024/file/a01e69aa9c3c61fcb40ea378e71fc780-Paper-Conference.pdf).

Otros candidatos revisados:

| Recurso | Por qué no lo elegiría primero |
|---|---|
| **Ninapro DB8** | Diseñado para regresión, pero EMG derecho y guante izquierdo: referencia contralateral. Guante de 18 sensores sin medición directa de las cuatro DIP. Fuentes discrepan sobre 25/100 Hz nativos. |
| **MOVMUS-UJI / ERGOMOVMUS** | Muy rico en actividades y bimanualidad; guantes de 18 sensores. Publicación centrada en actividad EMG procesada. Mayor distancia del objetivo de señal cruda de un brazalete y quince flexiones independientes. |
| **Reach&Grasp, 2025** | Captura multimodal amplia de brazo/mano, pero guante de 18 sensores, sin medición directa de las cuatro DIP. Más apropiado para estudiar alcance, interacción y musculatura de todo el miembro superior. |
| **HD-FW KIN, 2025** | 448 canales EMG; 21 participantes totales, subconjunto cinemático publicado de 10. Guante 5DT 14 Ultra a 200 Hz, exportado como valores normalizados 0–1; no grados absolutos. Acceso con cuenta/acuerdo PhysioNet. |
| **SEEDS, 2019** | 126 canales anteriores y 8 posteriores; CyberGlove III a 60 Hz nativos, remuestreado a 256 Hz. Sus 18 etiquetas están normalizadas, no expresadas en grados anatómicos; no mide directamente las cuatro DIP. |
| **DexEMG, 2026** | gForce de 8 canales + MANUS; referencia final de 22 articulaciones robóticas obtenida por retargeting. No se confirmó descarga pública de señales ni licencia de datos. |
| **EgoEMG, 2026** | Ocho EMG por muñeca, pero referencia óptica/modelada, sin guante. Preprint y repositorio difieren en cohorte; distribución anunciada por Baidu no verificada en esta revisión. |

Fuentes: [DB8](https://ninapro.hevs.ch/instructions/DB8.html), [artículo DB8](https://homepages.inf.ed.ac.uk/svijayak/publications/krasoulis-FrontiersNeuroscience2019.pdf), [MOVMUS](https://pmc.ncbi.nlm.nih.gov/articles/PMC10662444/), [Reach&Grasp](https://www.nature.com/articles/s41597-025-04552-5), [HD-FW KIN y acceso](https://physionet.org/content/hand-kinematics-semg/1.0.0/), [detalle cinemático HD-FW KIN](https://www.nature.com/articles/s41597-025-04749-8), [SEEDS](https://pmc.ncbi.nlm.nih.gov/articles/PMC6768861/), [DexEMG](https://arxiv.org/html/2603.05861v1), [EgoEMG](https://arxiv.org/html/2605.05712v1).

## Una alternativa importante aunque no use guante

**emg2pose** es una referencia fuerte para modelos y evaluación: 193 participantes, 370 horas, 16 EMG a 2 kHz y captura óptica de 26 cámaras. Esa captura no debe equipararse a estimaciones de una sola webcam. Incluye regresión y seguimiento, particiones por usuario/movimiento y código de entrenamiento. [Artículo original](https://arxiv.org/abs/2412.02725).

El repositorio proporciona una muestra de unos 600 MiB, frente a 431 GiB completos, y licencia CC BY-NC-SA 4.0. Lo consideraría como comparación metodológica si se acepta una referencia óptica. Sus pesos/modelos no se transfieren automáticamente a ocho canales. [Repositorio oficial](https://github.com/facebookresearch/emg2pose).

## Descargas y licencias comprobadas

Tamaños decimales salvo donde se indica GiB/MiB. Se comprobaron catálogos, APIs y algunas muestras; no se descargaron todas las bases.

| Recurso | Volumen orientativo | Licencia publicada / estado |
|---|---:|---|
| [sEMG-MANUS](https://zenodo.org/records/19261324) | ZIP 594,4 MB | CC BY 4.0; muestra leída |
| [Ninapro DB5](https://zenodo.org/records/1000116) | 201,7 MB | CC BY-ND 4.0; sujeto 1 comprobado |
| [Ninapro DB9 v3](https://zenodo.org/records/3480074) | 6,50 GB calibrados; 6,81 GB con originales | CC BY 4.0; contraparte del sujeto 1 comprobada |
| [DB2 / depósito DB1+2+3](https://datadryad.org/dataset/doi:10.5061/dryad.1k84r) | Descarga por sujeto; S1 DB2 ≈470 MB | CC0 en metadatos del depósito |
| [KIN-MUS-UJI](https://zenodo.org/records/3469380) | Dos MAT ≈214,4 MB | CC BY 4.0; catálogo verificado |
| [MyoKi](https://doi.org/10.6084/m9.figshare.28696778.v1) | 143,51 GB señales; 145,46 GB completo | CC BY 4.0; API e inventario verificados |
| [DB8](https://doi.org/10.25405/data.ncl.9577598.v1) | 25,39 GB | CC BY 4.0 en Newcastle |
| [MOVMUS-UJI v3](https://zenodo.org/records/14227751) | ZIP 4,59 GB | CC BY 4.0; guía y API verificadas |
| [Reach&Grasp](https://doi.org/10.48557/L6OWMM) | 30,68 GB | CC BY 4.0; API y esquema de canales verificados |
| [SEEDS](https://osf.io/wa3qk/) | 59,74 GB de participantes | CC BY 4.0; catálogo OSF verificado |
| [PiMForce: acceso desde web oficial](https://pimforce.hcitech.org/) | ZIP 8,20 GB | Acceso Dropbox público observado; licencia específica de señales no confirmada |
| [HD-FW KIN](https://physionet.org/content/hand-kinematics-semg/1.0.0/) | No verificado | Acuerdo y licencia restringida PhysioNet |
| [emg2pose](https://github.com/facebookresearch/emg2pose) | 600 MiB piloto; 431 GiB completo | CC BY-NC-SA 4.0 |

Las licencias de artículos, páginas web, software y señales son distintas. Esta tabla identifica las declaraciones de los depósitos; no supone que todas permitan la misma redistribución de datos modificados.

## Experimento recomendado para la tesis

1. **Cerrar el objetivo angular.** Definir explícitamente articulaciones, signos, unidades y ceros. Para el pulgar conservar oposición/abducción si el objetivo es una mano realista: tres valores de flexión no describen toda su postura.
2. **Auditar un piloto MANUS y DB5+DB9.** Comprobar continuidad, duplicados, rangos, períodos inválidos, correspondencia y mapas de articulaciones. Mantener referencias medidas, calibradas y reconstruidas identificadas por separado.
3. **Separar sujetos/sesiones antes de crear ventanas.** Reservar pruebas en sujetos y colocaciones del sensor no usados para ajustar. No repartir aleatoriamente ventanas solapadas: produciría una evaluación demasiado favorable.
4. **Entrenar regresión causal.** Comparar un modelo base sencillo con una red temporal en PyTorch/TensorFlow. Usar sólo EMG pasado/presente al inferir; ajustar normalización y selección de desfase únicamente con entrenamiento. No fijar 300 ms de retraso porque apareció en el dataset anterior.
5. **Medir MAE/RMSE por articulación, error de trayectoria y latencia.** La correlación sola puede ser alta pese a offsets y amplitudes incorrectas. Reportar por separado pulgar, DIP, movimientos rápidos, sujetos nuevos y casos con contacto.
6. **Validar con EMG PRO real.** Confirmar frecuencia efectiva por COM, escalas, filtrado, orden y colocación de electrodos. La transferencia entre dispositivos debe medirse con grabaciones propias sincronizadas con una referencia, idealmente el guante que se pueda utilizar en el laboratorio.
7. **Conectar al simulador mediante un mapa articular explícito.** Registrar tanto la predicción original como la postura permitida por el simulador. La física y las colisiones siguen siendo necesarias con EMG; limitar la animación no debe esconder errores del modelo en la evaluación.

Son propuestas para el proyecto, no resultados de entrenamiento. El guante se necesita como referencia durante captura/calibración/evaluación; una vez validado el modelo, la inferencia prevista usa el brazalete EMG. No se encontró evidencia de que alguno de estos datasets garantice posición «exacta» para cualquier persona, dispositivo y movimiento.

## Evidencia conservada en el proyecto

- [Evaluación y muestra sEMG-MANUS](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/investigacion_datasets/SEMG_MANUS.md>).
- [Ninapro: emparejamiento, frecuencias y mapa articular](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/investigacion_datasets/NINAPRO.md>).
- [MyoKi: canales, calibración y tamaños](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/investigacion_datasets/MYOKI.md>).
- [Otras bases con guantes](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/investigacion_datasets/ALTERNATIVAS_GUANTES.md>).
- [DexEMG](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/investigacion_datasets/DEXEMG.md>) y [EgoEMG](<C:/Users/psmjr/OneDrive/Documentos/ChatGPT/Tesis 2/analisis_datos/investigacion_datasets/EGOEMG.md>).

También se guardaron APIs, código de adquisición consultado como texto y scripts propios reproducibles de auditoría. No se ejecutó software descargado de terceros, no se entrenó ningún modelo y no se alteraron las señales originales de Datos-Train.
