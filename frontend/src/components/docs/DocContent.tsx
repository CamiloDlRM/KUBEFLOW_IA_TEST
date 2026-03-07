import { type DocSection } from './DocsSidebar';
import { CodeBlock } from './CodeBlock';
import { Callout } from './Callout';

function IntroSection() {
  return (
    <>
      <h1 className="text-3xl font-bold text-white mb-3">
        Introduccion a MLOps Platform
      </h1>
      <p className="text-lg text-[#a1a1aa] mb-8">
        Todo lo que necesitas para automatizar tus pipelines de Machine Learning
      </p>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        ¿Como funciona?
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-6">
        La plataforma automatiza el ciclo completo de Machine Learning. Cuando
        haces push a GitHub, un webhook notifica al backend, que descarga tu
        repositorio, valida el notebook, ejecuta el entrenamiento, registra las
        metricas en MLflow y, si el modelo cumple el umbral de accuracy, lo
        despliega automaticamente como API REST.
      </p>
      <p className="text-[#a1a1aa] leading-relaxed mb-6">
        El flujo completo es:{' '}
        <span className="text-white font-medium">
          Push a GitHub → Webhook → Descarga → Validacion → Ejecucion →
          Registro en MLflow → Deploy automatico
        </span>
      </p>

      <Callout label="Consejo">
        Para comenzar rapidamente, registra tu repositorio GitHub y haz push de
        un notebook con las tags mlops requeridas. La plataforma se encargara
        del resto.
      </Callout>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Arquitectura de la Plataforma
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-6">
        La plataforma se compone de 6 servicios Docker orquestados con
        Docker Compose:
      </p>

      <CodeBlock language="yaml">{`services:
  backend:    # FastAPI - API REST principal
  worker:     # Celery - Ejecucion asincrona de pipelines
  redis:      # Redis - Broker de mensajes para Celery
  mlflow:     # MLflow - Registro de experimentos y modelos
  model-server: # Servidor de inferencia de modelos
  frontend:   # React + Vite - Interfaz de usuario`}</CodeBlock>

      <p className="text-[#a1a1aa] leading-relaxed mt-6">
        Cada servicio se ejecuta en su propio contenedor, permitiendo escalar
        componentes individualmente segun la demanda.
      </p>
    </>
  );
}

function UploadSection() {
  return (
    <>
      <h1 className="text-3xl font-bold text-white mb-3">
        Cargar un Modelo
      </h1>
      <p className="text-lg text-[#a1a1aa] mb-8">
        Aprende a registrar tu repositorio y preparar tu notebook para el
        pipeline automatico
      </p>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Paso 1: Registrar repositorio
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        Registra tu repositorio de GitHub usando el endpoint{' '}
        <code className="px-1.5 py-0.5 bg-[#27272a] rounded text-sm text-white font-mono">
          POST /repos
        </code>
        . Esto configura automaticamente el webhook que dispara el pipeline.
      </p>

      <CodeBlock language="bash">{`curl -X POST http://localhost:8000/repos \\
  -H "Content-Type: application/json" \\
  -d '{
    "owner": "tu-usuario",
    "name": "tu-repo",
    "branch": "main"
  }'`}</CodeBlock>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Paso 2: Preparar el notebook
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        Tu notebook Jupyter debe contener celdas con las tags de MLOps que el
        sistema usa para identificar cada fase del pipeline:
      </p>

      <CodeBlock language="python">{`# Celda con tag: mlops:config
MODEL_NAME = "mi-modelo-clasificador"
TARGET_COLUMN = "label"
TEST_SIZE = 0.2

# Celda con tag: mlops:preprocessing
import pandas as pd
df = pd.read_csv("data.csv")
X = df.drop(columns=[TARGET_COLUMN])
y = df[TARGET_COLUMN]

# Celda con tag: mlops:training
from sklearn.ensemble import RandomForestClassifier
model = RandomForestClassifier(n_estimators=100)
model.fit(X_train, y_train)

# Celda con tag: mlops:export
import joblib
joblib.dump(model, "model.pkl")`}</CodeBlock>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Paso 3: Hacer push
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        Al hacer <code className="px-1.5 py-0.5 bg-[#27272a] rounded text-sm text-white font-mono">git push</code>{' '}
        a la rama configurada, el webhook dispara automaticamente el pipeline.
        Puedes ver el progreso en tiempo real desde la pagina de Pipeline Detail
        en la interfaz web.
      </p>

      <Callout label="Importante">
        El notebook debe contener las 4 tags obligatorias (mlops:config,
        mlops:preprocessing, mlops:training, mlops:export) para pasar la fase
        de validacion. Si falta alguna, el pipeline fallara con un error
        descriptivo.
      </Callout>
    </>
  );
}

function TestSection() {
  return (
    <>
      <h1 className="text-3xl font-bold text-white mb-3">
        Testear el Modelo
      </h1>
      <p className="text-lg text-[#a1a1aa] mb-8">
        Como enviar predicciones de prueba a tu modelo desplegado
      </p>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Prediccion via API
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        Una vez que tu modelo esta desplegado, puedes enviar datos de prueba al
        endpoint de prediccion:
      </p>

      <CodeBlock language="bash">{`curl -X POST http://localhost:8000/models/mi-modelo-clasificador/predict \\
  -H "Content-Type: application/json" \\
  -d '{
    "data": {
      "feature_1": 5.1,
      "feature_2": 3.5,
      "feature_3": 1.4,
      "feature_4": 0.2
    }
  }'`}</CodeBlock>

      <p className="text-[#a1a1aa] leading-relaxed mt-4 mb-6">
        La respuesta incluira la prediccion del modelo y la confianza:
      </p>

      <CodeBlock language="json">{`{
  "prediction": "setosa",
  "confidence": 0.97,
  "model_version": "3",
  "response_time_ms": 12
}`}</CodeBlock>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Prediccion desde la interfaz web
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        Tambien puedes testear directamente desde la interfaz. Navega a la
        pagina <code className="px-1.5 py-0.5 bg-[#27272a] rounded text-sm text-white font-mono">/models</code>,
        haz click en el boton <span className="text-white font-medium">Test</span> de cualquier
        modelo, y usa el editor JSON para enviar datos de prueba. El resultado
        aparecera en tiempo real.
      </p>

      <Callout label="Tip">
        Puedes usar el modal de prediccion en la interfaz web para probar sin
        usar la terminal. Es especialmente util para iterar rapidamente con
        diferentes inputs.
      </Callout>
    </>
  );
}

function MetricsSection() {
  return (
    <>
      <h1 className="text-3xl font-bold text-white mb-3">
        Metricas y Resultados
      </h1>
      <p className="text-lg text-[#a1a1aa] mb-8">
        Como interpretar las metricas de entrenamiento y monitorear el
        rendimiento de tus modelos
      </p>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Metricas automaticas
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        MLflow registra automaticamente las metricas de cada ejecucion del
        pipeline:
      </p>

      <CodeBlock language="text">{`accuracy:   0.94    # Precision general del modelo
precision:  0.93    # Precision por clase (promedio ponderado)
recall:     0.94    # Sensibilidad por clase (promedio ponderado)
f1-score:   0.93    # Media armonica de precision y recall`}</CodeBlock>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Umbral de auto-deploy
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        El sistema usa un umbral de{' '}
        <code className="px-1.5 py-0.5 bg-[#27272a] rounded text-sm text-white font-mono">
          accuracy &gt;= 0.70
        </code>{' '}
        para decidir si un modelo se despliega automaticamente. Si la accuracy
        es menor, el modelo se registra en MLflow pero{' '}
        <span className="text-white font-medium">no se despliega</span>.
      </p>

      <Callout label="Nota">
        Si la accuracy es menor a 0.70, el modelo NO se desplegara
        automaticamente. Puedes ajustar este umbral en la variable{' '}
        <code className="px-1 py-0.5 bg-[#27272a] rounded text-xs font-mono text-white">
          MIN_ACCURACY_THRESHOLD
        </code>{' '}
        del archivo de configuracion del backend.
      </Callout>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Ver metricas en la interfaz
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        Navega a la pagina de <span className="text-white font-medium">Pipeline Detail</span>{' '}
        para ver el panel de metricas con grafica historica de cada ejecucion.
        Puedes comparar versiones del modelo y ver como evolucionan las metricas
        a lo largo del tiempo.
      </p>

      <div className="h-px bg-[#27272a] my-8" />

      <h2 className="text-xl font-semibold text-white mb-4">
        Acceso directo a MLflow
      </h2>
      <p className="text-[#a1a1aa] leading-relaxed mb-4">
        Para un analisis mas detallado, accede directamente a la interfaz de
        MLflow en{' '}
        <code className="px-1.5 py-0.5 bg-[#27272a] rounded text-sm text-white font-mono">
          http://localhost:5000
        </code>
        . Ahi podras explorar todos los experimentos, comparar runs, ver
        artefactos y descargar modelos.
      </p>
    </>
  );
}

interface DocContentProps {
  section: DocSection;
}

export function DocContent({ section }: DocContentProps) {
  switch (section) {
    case 'intro':
      return <IntroSection />;
    case 'upload':
      return <UploadSection />;
    case 'test':
      return <TestSection />;
    case 'metrics':
      return <MetricsSection />;
  }
}
