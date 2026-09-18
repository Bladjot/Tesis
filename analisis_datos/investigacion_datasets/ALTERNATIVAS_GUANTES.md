# Alternativas públicas con cinemática de mano y EMG

Revisión de fuentes primarias y metadatos públicos: **18 de septiembre de 2026**. Alcance complementario: KIN-MUS-UJI, MOVMUS-UJI/ERGOMOVMUS, Reach&Grasp, SEEDS, PiMForce y el conjunto de reajuste de alcance/agarre de Furmanek. Ninapro, MyoKi, sEMG-MANUS y EgoEMG se revisan en otros informes.

**Conclusión para esta tesis:** KIN-MUS-UJI es una alternativa accesible para comenzar con EMG cruda y ángulos calibrados; tiene **7 canales reales**, no 8, y no incluye DIP independientes de los cuatro dedos largos. MOVMUS amplía mucho las actividades, pero la distribución documentada contiene envolventes procesadas. PiMForce coincide mejor con ocho canales y declara 20 parámetros angulares, aunque el experimento está diseñado para estimar presión y su licencia específica de datos requiere aclaración.

Se inspeccionaron artículos, APIs de repositorios, listados y documentos pequeños. **No se descargaron los archivos completos ni se validó numéricamente el contenido de sus matrices.** Los tamaños son bytes declarados por los servidores, expresados en MB/GB decimales. «Abierto» describe acceso sin autenticación observado, no equivale por sí solo a una licencia de reutilización.

| Dataset | EMG adquirido | Cinemática nativa / publicada | Etiquetas para flexión | Acceso observado y volumen |
|---|---|---|---|---|
| KIN-MUS-UJI | 7 canales, 1.000 Hz | CyberGlove I, 100 Hz | 18 ángulos calibrados; 11 flexiones de dedos; sin 4 DIP | Zenodo abierto, CC BY 4.0; dos MAT útiles: 214,38 MB |
| MOVMUS-UJI v3 | 7 por antebrazo, 1.000 Hz; bilateral cuando corresponde | CyberGlove II/III, 100 Hz; envolventes EMG a 100 Hz | Esquema de 18 ángulos por mano; sin 4 DIP; arco palmar derecho defectuoso | Zenodo abierto, CC BY 4.0; ZIP: 4,59 GB |
| Reach&Grasp | 64 HD + 10 bipolares, 2.000 Hz | CyberGlove I, 100 Hz; Vicon adicional | 18 canales declarados DEG; sin DIP independientes | IIT Dataverse, CC BY 4.0, archivos individuales; total 30,68 GB |
| SEEDS | 126 HD anteriores + 8 posteriores, 16.384 Hz nativos; 2.048 Hz publicados | CyberGlove III, **60 Hz nativos → 256 Hz** publicados | 18 señales normalizadas; no grados físicos; sin DIP independientes | OSF público, CC BY 4.0; carpetas de 25 participantes: 59,74 GB |
| PiMForce | 8 Delsys, 2.000 Hz | MANUS Quantum, **120 Hz → 2.000 Hz** por interpolación | 20 parámetros, incluidos DIP en la salida del fabricante | Dropbox público; ZIP 8,20 GB; licencia específica de datos no confirmada |
| Reajuste reach-to-grasp | 10 Delsys, 1.000 Hz | Seguimiento óptico 75 Hz → 100 Hz | Posiciones de muñeca y puntas de pulgar/índice; no ángulos articulares completos | Figshare público, CC0; 2,93 GB completo / 322,67 MB subconjunto |

## 1. KIN-MUS-UJI: corregir «no hay EMG cruda»

El estudio registra **22 participantes diestros, 26 actividades y 572 registros**, con guante y EMG en la mano/antebrazo derechos. El equipo admite ocho canales, pero se usaron **siete electrodos**, no ocho. CyberGlove I tiene 18 sensores y calibración anatómica no lineal; los ángulos se filtran a 5 Hz. La distribución procesada incluye envolventes EMG normalizadas a 100 Hz, mientras la adquisición EMG es a 1.000 Hz. El software coordina las capturas y conserva tiempo y fases de alcance, manipulación y liberación. [Artículo original](https://pmc.ncbi.nlm.nih.gov/articles/PMC6848200/).

El registro actual de Zenodo **sí publica `RAW_EMG.mat`**, con Subject, ADL, Time y siete columnas de EMG, descritas sin filtrado ni remuestreo. `KIN_MUS_UJI.mat` contiene ángulos y señales procesadas. No confundir la petición de acceso a señales crudas **del guante** mencionada en el artículo con la disponibilidad actual de EMG cruda. [Repositorio y descripción](https://zenodo.org/records/3469380), [metadatos verificables](https://zenodo.org/api/records/3469380).

- `KIN_MUS_UJI.mat`: **86.661.263 bytes**.
- `RAW_EMG.mat`: **127.723.110 bytes**.
- Ambos: **214.384.373 bytes**; los vídeos de ejemplo son prescindibles.
- Licencia del registro: **CC BY 4.0**, acceso abierto.

Los 18 ángulos reúnen CMC/MCP/IP del pulgar, MCP/PIP de los otros dedos, abducciones, arco palmar y muñeca. Por ello hay **11 flexiones digitales**: tres del pulgar y ocho MCP/PIP. **No hay cuatro DIP independientes**. La alineación entre MAT debe verificarse mediante participante, ADL y tiempo, sin suponer que la fila de EMG cruda coincide con la fila de cinemática a 100 Hz. [Esquema y procesamiento del artículo](https://pmc.ncbi.nlm.nih.gov/articles/PMC6848200/).

**Valoración:** primera alternativa práctica de este grupo para entrenar una regresión EMG cruda → ángulos calibrados. La transferencia a EMGPRO exige adaptar siete entradas reales y la colocación de electrodos; no aporta la octava señal por interpolación.

## 2. MOVMUS-UJI / ERGOMOVMUS: más actividades, atención a la versión

El artículo de 2023 describe 161 actividades cotidianas, 105 productos y 4.186 registros. Emplea siete sensores EMG por antebrazo y guantes en las mismas manos: CyberGlove II derecho y III izquierdo. Las fases unilaterales usan la derecha y la fase bimanual ambas manos. Las envolventes se normalizan y remuestrean a 100 Hz. **Catorce canales bilaterales no equivalen a catorce canales de un antebrazo.** [Artículo](https://pmc.ncbi.nlm.nih.gov/articles/PMC10662444/), [DOI](https://doi.org/10.1038/s41597-023-02723-w).

La **guía v3** del registro actual aclara aspectos relevantes:

- P. 7: **26 participantes por fase, 30 personas únicas y 22 presentes en las tres fases**. No dividir entrenamiento/prueba ignorando identidades repetidas entre fases.
- P. 7: EMG nativa a **1.000 Hz**, guantes a **100 Hz**.
- P. 13: el sensor de **arco palmar derecho falló** y ese grado de libertad no se informa correctamente, aunque el esquema de columnas lo enumera.
- Pp. 14 y 20: el ZIP documenta `KIN_EMG_DATA.mat`, `PARTICIPANT_DATA.mat`, `TASK_DATA.mat` y `PRODUCT_DATA.mat`; la matriz de señales tiene 18 columnas angulares por lado y 14 EMG procesadas. **No documenta un archivo de EMG cruda**: su publicación no quedó confirmada.
- Los ángulos se expresan en grados; no se añaden DIP independientes. La guía presenta una discrepancia sobre el filtro cinemático: resumen a **10 Hz** frente al detalle a **5 Hz**. Debe aclararse antes de reproducir exactamente el preprocesamiento.

Fuente de estos detalles: [guía oficial v3](https://zenodo.org/api/records/14227751/files/MOVMUS-UJI%20DATASET%20GUIDE%20v3.pdf/content). Copia local de consulta: `fuentes/MOVMUS-UJI_DATASET_GUIDE_v3.pdf`.

El [registro actual](https://zenodo.org/records/14227751) y su [API](https://zenodo.org/api/records/14227751) declaran acceso abierto y **CC BY 4.0**. `MOVMUS-UJI_DATASET.zip` pesa **4.586.439.958 bytes**. ERGOMOVMUS es también la herramienta de exploración incluida; no representa un nuevo juego de canales.

**Valoración:** útil para diversidad funcional y regresión desde activación muscular procesada. No elegirlo suponiendo que entrega automáticamente EMG cruda a 500/1.000 Hz para reproducir el sensor propio.

## 3. Reach&Grasp: abierto y multimodal, distinto al hardware propio

Diez participantes realizan 16 tareas, con diez repeticiones, usando mano y brazo derechos. Se capturan **64 canales HD** en dos matrices del antebrazo y **10 bipolares** en músculos principalmente proximales, ambos a 2.000 Hz. Los diez bipolares no son una pulsera de diez canales de antebrazo. CyberGlove I registra 18 canales a 100 Hz; Vicon añade marcadores, sin proporcionar todos los ángulos interfalángicos. [Artículo de 2025](https://www.nature.com/articles/s41597-025-04552-5), [copia PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11805991/).

La sincronización combina disparos de hardware para parte del sistema y sincronización NTP de ordenadores para el guante; no debe describirse como un TTL común a todos los dispositivos. El artículo comenta el escalado por participante del guante. La calibración táctil es un asunto distinto: la falta de presión absoluta de los taxeles no demuestra por sí misma falta de calibración angular. [Métodos](https://pmc.ncbi.nlm.nih.gov/articles/PMC11805991/).

Los pequeños archivos públicos [channels.tsv](https://dataverse.iit.it/api/access/datafile/14005) y [motion.json](https://dataverse.iit.it/api/access/datafile/14007) declaran **DEG**, 100 Hz, mano derecha y CyberGlove 1.1. Enumeran MCP/PIP, pulgar, abducciones, arco palmar y muñeca; **no DIP independientes**. No se confirmó una validación externa de precisión angular individual: unidades declaradas no equivalen a error angular validado.

El [dataset](https://doi.org/10.48557/L6OWMM) tiene **2.389 archivos, ninguno restringido**, en versión 1.0; total **30.683.095.772 bytes**, según [API de Dataverse](https://dataverse.iit.it/api/datasets/:persistentId/?persistentId=doi:10.48557/L6OWMM). Datos: **CC BY 4.0**. [Código](https://github.com/DarioDiDomenico/SData_ReachGrasp): MIT, licencia distinta. Permite seleccionar archivos sin descargar todo.

**Valoración:** buen banco multimodal; seleccionar ocho canales HD requiere justificar ubicación y adaptación, no implica equivalencia con EMGPRO.

## 4. SEEDS: alta densidad y etiquetas normalizadas

SEEDS incluye 25 participantes, 13 movimientos, tres sesiones y seis repeticiones: 234 ensayos por persona, con velocidades lenta y rápida. Registra el antebrazo y guante izquierdos: **126 canales anteriores HD + 8 posteriores**. Adquiere EMG a 16.384 Hz y publica señales procesadas a 2.048 Hz; la señal original de mayor frecuencia se solicita a los autores. [Artículo](https://www.nature.com/articles/s41597-019-0200-9), [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6768861/).

CyberGlove III tiene **60 Hz nativos**; las señales publicadas a **256 Hz son remuestreadas**. Los pulsos de cada muestra del guante registrados junto al EMG permiten alinear señales. Los sensores se normalizan mediante calibración mínimo/máximo a valores cercanos a **0–1**, no a grados anatómicos; algunas señales pueden exceder ese intervalo por la cobertura de la calibración. Dos sensores de flexión por dedo largo no aportan un DIP independiente. [Métodos y formato de datos](https://pmc.ncbi.nlm.nih.gov/articles/PMC6768861/).

El [repositorio OSF](https://osf.io/wa3qk/) es público y su [registro API](https://api.osf.io/v2/nodes/wa3qk/) referencia [CC BY 4.0](https://api.osf.io/v2/licenses/563c1cf88c5e4a3877f9e96a/). La enumeración de las 25 carpetas de participantes y sus componentes públicos arroja **59.736.873.118 bytes**, excluyendo material adicional; aproximadamente 2,39 GB por participante. No se descargaron matrices.

**Valoración:** útil para movimientos continuos, pero convertir etiquetas normalizadas a grados multiplicando por 90 sería injustificado. Los ocho canales posteriores tampoco reproducen una pulsera circunferencial de ocho canales.

## 5. PiMForce: ocho EMG y veinte parámetros, objetivo principal presión

El artículo emplea **8 Delsys Trigno Avanti a 2.000 Hz**, distribuidos con soporte TPU, y MANUS Quantum Metaglove a **120 Hz**. Los 20 parámetros corresponden a abducción y tres flexiones por dedo; la salida incluye DIP de los dedos largos. **No demuestra que DIP proceda de medición independiente de cada articulación frente al modelo cinemático del fabricante.** Hay calibración inicial del tamaño de mano, pero no una validación angular externa para asumir precisión de grado. Las señales angulares se interpolan linealmente al tiempo EMG; 2.000 Hz no es la frecuencia nativa del guante. [Artículo NeurIPS 2024](https://papers.nips.cc/paper_files/paper/2024/file/a01e69aa9c3c61fcb40ea378e71fc780-Paper-Conference.pdf).

**Cobertura de movimiento:** el apéndice B.3 pide repetir cada interacción 12–15 veces durante 30 segundos. En Plane se aplica y libera fuerza sobre una superficie; en Pinch/Grasp la izquierda estabiliza el objeto mientras la derecha aplica y libera fuerza. Hay cinemática continua, pero el protocolo favorece **variación de fuerza dentro de posturas**; no establece barridos independientes de cada articulación ni cobertura amplia de transiciones libres. Se estudiaron 21 participantes y 22 interacciones. [Texto completo con apéndice](https://pimforce.hcitech.org/static/pdfs/Posture-Informed%20Muscular%20Force%20Learning%20for%20Robust%20Hand%20Pressure%20Estimation_compressed.pdf).

La [web oficial](https://pimforce.hcitech.org/) enlaza una [carpeta pública Code & Data](https://www.dropbox.com/scl/fo/m7qye1l3ii6hlwgzlajyv/ADhaUZvH2eDJ3ggmGAlN5k0?rlkey=eyt5gs66uimhiw3dismnylamw&dl=0). Una consulta HEAD al ZIP confirma acceso sin sesión y **8.200.737.484 bytes**, sin descargarlo. El [README](https://www.dropbox.com/scl/fo/m7qye1l3ii6hlwgzlajyv/AO_3toLxUlsCwN2FvvBn6mA/Codes/README.md?rlkey=eyt5gs66uimhiw3dismnylamw&dl=1) documenta User1–21, tres sesiones y carpetas `emg`, `angles`, `fsr`, `pps`; enumera **21 acciones**, frente a 22 del artículo. Esta discrepancia requiere inspección del archivo antes de calcular cobertura.

Se leyó el pequeño archivo [LICENSE del código](https://www.dropbox.com/scl/fo/m7qye1l3ii6hlwgzlajyv/AKWacFmQQ-mAAURn4wz2VEM/Codes/LICENSE?rlkey=eyt5gs66uimhiw3dismnylamw&dl=1): **MIT para software y documentación**. **La licencia específica de reutilización del dataset no quedó confirmada.** La licencia de la web tampoco debe trasladarse a los datos. No se verificaron unidades ni columnas reales de los CSV angulares. No se ejecutó código descargado.

**Valoración:** candidato complementario interesante por ocho canales y salida angular rica, especialmente para presión condicionada por postura. No lo priorizaría sobre un conjunto diseñado para trayectorias articulares hasta revisar rangos, transiciones, unidades y licencia.

## 6. «Online adjustment»: precisar el nombre y el tipo de etiqueta

El conjunto localizado es **A kinematic and EMG dataset of online adjustment of reach-to-grasp movements to visual perturbations**, no un conjunto de fuerza de agarre con guante. Incluye 20 participantes y perturbaciones de tamaño/distancia de un objeto virtual durante una pinza pulgar–índice. Diez EMG Delsys a 1.000 Hz se sincronizan mediante pulsos; captura óptica a 75 Hz se publica a 100 Hz. Sus etiquetas son posiciones de **muñeca, punta del pulgar y punta del índice**, transporte y apertura. No proporciona un vector completo de ángulos de dedos ni fuerza de contacto real de ese objeto virtual. [Artículo](https://pmc.ncbi.nlm.nih.gov/articles/PMC8782875/), [DOI](https://doi.org/10.1038/s41597-021-01107-2).

El [registro de Figshare](https://figshare.com/articles/dataset/13377506) y su [API](https://api.figshare.com/v2/articles/13377506) declaran **CC0**: `Full_Dataset.zip`, **2.927.745.274 bytes**; `Small_Subset.zip`, **322.673.031 bytes**. Acceso público verificado mediante metadatos, sin descargar ZIP.

**Valoración:** sirve para control de alcance/pinza y respuesta a perturbaciones; no supervisa los 15 ángulos articulares que podría requerir un simulador detallado.

## Decisión de uso y límites de comparación

Para una primera prueba reproducible de este grupo, usaría **KIN-MUS-UJI crudo + ángulos calibrados**, restringiendo la salida a articulaciones realmente presentes. MOVMUS sirve como extensión de actividades con entrada procesada; Reach&Grasp y SEEDS requieren mayor adaptación por densidad, tamaño o unidades. PiMForce merece un piloto posterior por sus ocho canales, condicionado a aclarar licencia y examinar la variación angular efectiva.

Separar estas decisiones en el diseño de la tesis:

1. **Objetivo cinemático:** cinco flexiones agregadas, once flexiones disponibles o quince flexiones con DIP. Un DIP calculado por acoplamiento puede animar la mano, pero debe rotularse como estimado y no como etiqueta medida.
2. **Frecuencia:** remuestrear una etiqueta de 60/100/120 Hz no genera nueva información motora. Si se reduce EMG a 500 Hz, hace falta filtro antialias compatible con Nyquist de 250 Hz; no copiar sin adaptación filtros de adquisición de 1/2 kHz.
3. **Transferencia:** igual número de canales no iguala posiciones, unidades, filtros, ganancia o músculos. Los siete canales de KIN/MOV y los ocho de PiMForce requieren evaluar correspondencia con EMGPRO.
4. **Validación:** separar por participante/sesión y ensayos completos; evitar que ventanas contiguas del mismo ensayo entren a ambos lados de la división. Publicar MAE en grados sólo cuando las etiquetas y su calibración sostengan esa unidad.

Estas son recomendaciones metodológicas derivadas de las fuentes, no resultados de entrenamiento ni una validación clínica o biomecánica de los sensores.
