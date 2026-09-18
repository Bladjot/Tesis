# EgoEMG: candidato reciente con ocho canales por mano, sin guante

Revisión: 18 de septiembre de 2026. Se consultó arXiv v1 y se fijó el repositorio al commit `f7cbd048b7092139852270491d3859cd472e0311`. Se leyeron documentación y código como texto, sin ejecutarlos ni descargar señales, pesos o vídeos.

**Evaluación para esta tesis:** candidato complementario por su entrada de ocho canales y salidas continuas, pero no satisface la preferencia de medición con guante. La disponibilidad de un enlace de distribución no basta todavía para declararlo descargado/verificado. No debe reemplazar de inmediato una base que ya podamos auditar.

## Qué mide

El preprint describe brazaletes **WAVELETECH en ambas muñecas**, ocho canales por lado a 2 kHz. FZMotion registra 21 marcadores por mano a 120 Hz. Un modelo aprendido reconstruye MANO y una optimización lo convierte a 20 ángulos de dedos más dos de muñeca. Son referencias derivadas de captura óptica y modelos; no lecturas directas de goniómetros o guantes. Sincronización: marcas temporales del computador e interpolación lineal. Reporta 41 participantes, más de diez horas y 60 familias de movimientos, con tareas guiadas y algunas libres. El documento propone CC BY-NC 4.0 para datos y MIT para código. [Preprint v1, secciones 3 y apéndices A/B](https://arxiv.org/html/2605.05712v1).

Aunque hay etiquetas de gesto, los objetivos del benchmark son trayectorias articulares, compatibles conceptualmente con regresión continua. Usar ocho entradas no elimina diferencias entre sensores de muñeca y antebrazo del usuario.

## Versiones y acceso

| Evidencia | Estado constatado |
|---|---|
| Preprint v1, 7 de mayo de 2026 | 41 participantes, >10 h; publicación de datos anunciada |
| README del repositorio al commit revisado | 53 participantes, >18 h; no coincide con v1 |
| ASSET_SETUP | Distribución mediante Baidu, clave `8059`; preview de tres episodios, formato memmap v3 |
| CHANGELOG | Primera versión pública de código: 23 de agosto de 2026; data card revisada y publicación formal de datos pendientes |
| DATA_CARD | Sigue siendo un marcador provisional, sin condiciones finales verificadas |
| Verificación de esta investigación | Código/documentación públicos comprobados; enlace Baidu no accesible desde la herramienta; ningún archivo de señales comprobado |

El aumento 41→53 y 10→18 h puede reflejar una ampliación, pero **es una inferencia**: no se encontró una correspondencia publicada completa entre cohortes, versiones y resultados. No se mezclan las cifras del README con el protocolo de v1 como si fueran una misma edición. [README fijado](https://github.com/zhenqis123/EgoEMG/blob/f7cbd048b7092139852270491d3859cd472e0311/README.md), [CHANGELOG fijado](https://github.com/zhenqis123/EgoEMG/blob/f7cbd048b7092139852270491d3859cd472e0311/CHANGELOG.md).

Para EMG→pose se necesita el memmap; vídeos y recortes no son necesarios. Los checkpoints EgoEMG EMGFormer usan ocho canales de una mano. Los de fusión y EMG2Pose tienen otra disposición de 16 canales y no son intercambiables. La documentación marca Google Drive como espejo antiguo y prioriza Baidu. No se pudo confirmar tamaño exacto ni descarga anónima de la versión actual. [Guía de archivos](https://github.com/zhenqis123/EgoEMG/blob/f7cbd048b7092139852270491d3859cd472e0311/docs/ASSET_SETUP.md).

## Unidades y esquema: hallazgo en el código

En `egoemg_memmap_dataset.py`, líneas 1864–1889 del commit fijado, `generated_joint_angles_left/right` se combina con ángulos de muñeca; los comentarios y operaciones `np.deg2rad` establecen que **los dedos se manejan en radianes y la muñeca se almacena en grados antes de convertirla**. El tensor final de 22 salidas queda en radianes. Esto debe distinguirse de las métricas publicadas en grados. No convertir indiscriminadamente todos los campos una segunda vez. [Loader de los autores](https://github.com/zhenqis123/EgoEMG/blob/f7cbd048b7092139852270491d3859cd472e0311/egoemg/datasets/egoemg_memmap_dataset.py#L1864).

El loader incluye `timestamp_us` y máscaras de validez para articulaciones y muñecas. El changelog registra semántica temporal no uniforme y correcciones del orden IMU, de modo que las versiones y checksums deben fijarse antes de reproducir resultados. No se auditó una serie temporal binaria en esta investigación.

## Qué falta antes de seleccionarlo como dataset principal

1. Acceder al preview oficial y revisar el manifiesto, unidades, orden articular, duración real, validez y sincronización.
2. Fijar una edición documentada y verificar qué participantes pertenecen a cada partición; aclarar la ampliación de cohortes.
3. Confirmar licencia de los datos efectivamente distribuidos. MIT cubre el código propio; no sustituye la licencia pendiente/documentada para señales ni las condiciones de MANO/UmeTrack. [DATA_CARD](https://github.com/zhenqis123/EgoEMG/blob/f7cbd048b7092139852270491d3859cd472e0311/docs/DATA_CARD.md), [terceros](https://github.com/zhenqis123/EgoEMG/blob/f7cbd048b7092139852270491d3859cd472e0311/THIRD_PARTY_NOTICES.md).
4. Si se utiliza su modelo o filtrado, verificar causalidad y demora real del flujo de inferencia; la precisión offline no demuestra respuesta en tiempo real con EMG PRO.

Documentación y código consultados se conservaron como texto en `fuentes_egoemg/` para trazabilidad. No se reutilizaron componentes del repositorio en el simulador.
