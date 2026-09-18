# Ninapro para regresión continua EMG → articulaciones

Revisión: 18 de septiembre de 2026. Fuentes: documentación oficial, artículos de los autores, fabricantes y metadatos de repositorios. No se entrenaron modelos ni se modificó el simulador.

**Recomendación para este proyecto:** dentro de Ninapro, iniciar con **DB5 (primer brazalete: columnas EMG 1–8) emparejado con DB9**, usando ángulos calibrados como objetivos. DB2 + DB9 amplía los sujetos. DB8 sirve como comparación de regresión, pero su referencia contralateral y la ausencia de cuatro DIP impiden tratarlo como verdad exacta de 15 articulaciones de la misma mano. Esta priorización es una evaluación para el dispositivo de ocho canales del usuario; compartir cantidad de canales no asegura transferencia entre Myo y EMG PRO.

## Comparación

| Base | Sujetos y protocolo | EMG | Guante y referencia | Limitación para esta tesis |
|---|---|---|---|---|
| DB5 | 10; 52 movimientos guiados, 6 repeticiones; ejercicios A/B/C | 16 canales de dos Myo, 200 Hz; se pueden usar separadamente | CyberGlove II de 22 sensores; `glove` sin calibrar; mano derecha | Usar DB9 para grados. Menor población; EMG de baja frecuencia |
| DB2 | 40; 49 movimientos/patrones, 6 repeticiones; B/C/D | 12 Delsys, 2 kHz; primeros 8 alrededor del antebrazo | CyberGlove II de 22 sensores; `glove` sin calibrar; misma mano | D es fuerza, no trayectoria articular; Delsys difiere de un brazalete |
| DB8 | 10 intactos + 2 amputados; 9 movimientos lentos; 3 bloques secuenciales: 10/10/2 repeticiones | Delsys; 1.111 Hz nativos, datos remuestreados a 2 kHz | CyberGlove II 18 DOF, calibración por sujeto; guante IZQUIERDO y EMG DERECHO | Referencia en espejo, cuatro DIP no medidos; no es movimiento libre |
| DB9 | 77 sujetos procedentes de DB1/DB2/DB5; sólo B/C (40 movimientos) | No incluye EMG: se recupera de la base original | Datos calibrados en posprocesamiento y `order_of_angles` | Sensor 11 original excluido por ruido; DIP afectados por ajuste del guante |

Fuentes de las filas: [DB5 oficial](https://ninapro.hevs.ch/instructions/DB5.html), [DB2 oficial](https://ninapro.hevs.ch/instructions/DB2.html), [DB8 oficial](https://ninapro.hevs.ch/instructions/DB8.html), [DB9 oficial](https://ninapro.hevs.ch/instructions/DB9.html). DB2 tiene una frase inicial de «10 repeticiones» que contradice su descripción posterior de seis; se conserva seis, consistente con el protocolo publicado.

## Frecuencia, calibración y precisión

En DB1/DB2/DB5 el guante transmitía a **algo menos de 25 Hz**. Se interpoló a 100/2.000/200 Hz respectivamente. Por tanto, las filas a 2 kHz de DB2 no representan 2.000 medidas independientes de ángulos cada segundo. DB9 utiliza ganancias obtenidas en diez personas y una postura de referencia; no es una calibración individual completa de sus 77 participantes. Las ganancias no se deben trasladar a otro guante. Los datos calibrados conservan trayectorias de aproximación y retirada, además de posturas sostenidas. [Artículo de DB9, Methods y Usage Notes](https://www.nature.com/articles/s41597-019-0349-2).

El artículo original de DB2 describe interpolación lineal de las señales continuas para la sincronización, y EMG Delsys con filtrado Hampel de interferencias de red. Esto debe tenerse en cuenta al reproducir el procesamiento en tiempo real. [Atzori et al., 2014](https://www.nature.com/articles/sdata201453).

**Contradicción sin resolver en DB8:** la ficha oficial y el depósito Newcastle afirman guante nativo a 100 Hz; el artículo de los autores dice **25 Hz**. El artículo también indica 13 y 12 sensores EMG para los dos amputados, frente a la descripción genérica de 16 en la ficha. Deben verificarse dimensiones por sujeto antes de procesar. No se presenta 100 Hz como frecuencia confirmada. El estudio evaluó cinco grados de actuación de una prótesis y normalizó esos objetivos; esto no permite suponer que los 18 canales del archivo ya sean los 15 ángulos deseados por el usuario. [Artículo, pp. 3–4](https://homepages.inf.ed.ac.uk/svijayak/publications/krasoulis-FrontiersNeuroscience2019.pdf), [metadatos Newcastle](https://api.figshare.com/v2/articles/9577598).

El CyberGlove de 18 sensores tiene dos sensores de flexión por dedo y puntas abiertas; el de 22 incorpora sensores adicionales distales. La resolución declarada de un sensor no equivale a la exactitud de toda la referencia: el fabricante publica repetibilidad media entre colocaciones de 3°. [Fabricante](https://www.cyberglovesystems.com/cyberglove-ii).

## Emparejamiento DB5 + DB9: comprobación de archivos

Se descargaron **en memoria** únicamente DB5 sujeto 1 (19.462.713 bytes) y su contraparte DB9 sujeto 68 (17.073.843 bytes). No se guardaron ZIP ni señales completas. El script local `auditar_ninapro.py` y el resultado `ninapro_pair_audit.json` permiten reproducir la auditoría.

| Archivo original | Archivo calibrado | Filas | Resultado |
|---|---|---:|---|
| `s1/S1_E2_A1.mat` | `s_68_angles/S68_E2_A1.mat` | 179.901 | `glove`, `stimulus`, `restimulus`, `repetition`, `rerepetition`: igualdad exacta |
| `s1/S1_E3_A1.mat` | `s_68_angles/S68_E3_A1.mat` | 258.372 | Igualdad exacta de los mismos cinco campos |

Esto confirma emparejamiento fila a fila para esos dos registros; **no prueba todos los sujetos**. Para el resto debe repetirse la comprobación antes de unir EMG y objetivos.

El catálogo oficial organiza DB9 1–27 como DB1, 28–67 como DB2, y 68–77 como DB5. Por ello, el candidato a DB9 para DB2 sujeto `s` es `s+27`, y para DB5 es `s+67`. También coinciden los datos demográficos. Cuidado: en los archivos auditados DB9 `S68`, el campo interno `subject` sigue valiendo 1. Además, `E2` y `E3` contienen `exercise=1` y `exercise=2`; no basta unir por este campo. [Catálogo y rutas oficiales](https://ninapro.hevs.ch/instructions/DB9.html).

El orden observado en `angles` es: CMC1_f, CMC1_a, MCP1, IP1, MCP2_f, MCP2_a, PIP2, MCP3_f, PIP3, MCP4_f, MCP4_a, PIP4, CMC5, MCP5_f, MCP5_a, PIP5, DIP2, DIP3, DIP4, DIP5, WRIST_F, WRIST_A. **No coincide con el orden de sensores `glove`**. Para tres flexiones por dedo se podrían seleccionar, en índices de MATLAB: pulgar [1,3,4], índice [5,7,17], medio [8,9,18], anular [10,12,19], meñique [14,16,20]. Es una propuesta de mapeo, que debe comprobarse contra ejes y signos del simulador; omite la oposición/abducción del pulgar.

La muestra contiene extremos de `angles` de −318,3 a 233,8° (E2) y −262,3 a 200,6° (E3). Es una alerta concreta de calidad, no un rango anatómico aceptado. Antes de entrenar hay que localizar canales/intervalos, revisar el guante original y decidir exclusiones justificadas; recortar todos los valores indiscriminadamente escondería problemas.

## Acceso real y licencias

| Recurso | Acceso comprobado | Tamaño publicado | Licencia del depósito |
|---|---|---:|---|
| DB5 | Descarga oficial sin cuenta; un ZIP leído y analizado | 201.699.536 bytes total | CC BY-ND 4.0 |
| DB9 v3 | ZIP oficial por sujeto leído; catálogo Zenodo abierto | 6.502.929.730 bytes calibrados + 302.758.376 bytes originales | CC BY 4.0 |
| DB8 | HTTP HEAD 200 para A1/A3 oficiales; API Newcastle pública | 25.386.544.354 bytes en Newcastle; S1 A1 1.000.769.862 bytes, A3 232.743.598 bytes | CC BY 4.0 en Newcastle |
| DB2 | Página y archivos individuales listados en Dryad; no descargados completos | S1 470,25 MB; colección DB1+2+3 23,27 GB | CC0 1.0 en JSON-LD del depósito |

Metadatos guardados en `ninapro_db5_metadata.json`, `ninapro_db8_metadata.json`, `ninapro_db9_metadata.json`. Fuentes: [DB5 Zenodo](https://zenodo.org/records/1000116), [DB9 v3 Zenodo](https://zenodo.org/records/3480074), [Newcastle DB8](https://doi.org/10.25405/data.ncl.9577598.v1), [DB2 Dryad](https://datadryad.org/dataset/doi:10.5061/dryad.1k84r). El artículo DB9 enlaza una versión anterior; v3 conserva el ZIP calibrado e incorpora originales. La licencia BY-ND de DB5 exige revisar condiciones antes de redistribuir versiones modificadas del dataset; no debe confundirse con BY.

## Uso recomendado

1. Piloto DB5 + DB9 con ocho EMG y los 15 objetivos propuestos; incluir transiciones, no sustituir ángulos por etiquetas de gesto.
2. Separar sujetos o bloques completos antes de crear ventanas. Reservar sujetos enteros para evaluar generalización; no dividir ventanas solapadas al azar.
3. Evaluar MAE/RMSE por articulación y latencia causal. Analizar por separado DIP y pulgar, afectados por limitaciones diferentes.
4. Ampliar con DB2 + DB9 si se necesita más población, sin asumir que Delsys y EMG PRO comparten escala, filtrado, banda útil o posición de electrodos.
5. Mantener DB8 como comparación adicional: bloques 1/2 para ajuste y bloque 3 reservado para prueba, especificando referencia contralateral. Estas tres adquisiciones son bloques secuenciales de una sesión, no una prueba de estabilidad durante varios días.

Estas son recomendaciones metodológicas para el proyecto, no garantías de exactitud o transferencia al brazalete del usuario.
