-- Schéma initial de l'application AIC SQDCPE.
-- Toutes les données métier sont rattachées à un site.

CREATE TABLE IF NOT EXISTS sites (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Niveaux d'AIC : N1 équipe, N2 global opération, N3 management site.
CREATE TABLE IF NOT EXISTS levels (
  site_id   int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  level     smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  instance  text NOT NULL,
  PRIMARY KEY (site_id, level)
);

-- Services (périmètres) : chaque service appartient à un niveau.
CREATE TABLE IF NOT EXISTS services (
  id        serial PRIMARY KEY,
  site_id   int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name      text NOT NULL,
  level     smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  ord       int NOT NULL DEFAULT 0,
  animator  text,
  deputy    text,
  UNIQUE (site_id, name)
);

CREATE TABLE IF NOT EXISTS indicators (
  id          serial PRIMARY KEY,
  site_id     int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  service_id  int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  pillar      char(1) NOT NULL CHECK (pillar IN ('S','Q','D','C','P','E')),
  label       text NOT NULL,
  unit        text,
  target      numeric,
  direction   text NOT NULL CHECK (direction IN ('>=','<=')),
  active      boolean NOT NULL DEFAULT true,
  on_chart    boolean NOT NULL DEFAULT false,
  aggregation text NOT NULL DEFAULT 'Somme' CHECK (aggregation IN ('Somme','Moyenne','Dernier')),
  axis_min    numeric,
  axis_max    numeric,
  axis_step   numeric,
  ord         int NOT NULL DEFAULT 0,
  UNIQUE (service_id, label)
);

-- Ex-onglet Journal : une mesure par indicateur et par jour d'AIC.
CREATE TABLE IF NOT EXISTS measurements (
  id            bigserial PRIMARY KEY,
  site_id       int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  indicator_id  int NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  aic_date      date NOT NULL,
  measure_date  date NOT NULL,
  value         numeric,
  target        numeric,
  status        text CHECK (status IN ('OK','NOK')),
  comment       text,
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (indicator_id, aic_date)
);
CREATE INDEX IF NOT EXISTS measurements_site_date ON measurements (site_id, aic_date);

-- Ex-onglet Actions : problèmes et actions.
CREATE TABLE IF NOT EXISTS actions (
  id                 serial PRIMARY KEY,
  site_id            int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  num                int NOT NULL,
  created_on         date NOT NULL DEFAULT current_date,
  requested_by       text,
  service_id         int REFERENCES services(id) ON DELETE SET NULL,
  level              smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  emitter_level      smallint NOT NULL DEFAULT 1 CHECK (emitter_level BETWEEN 1 AND 3),
  pillar             char(1) CHECK (pillar IN ('S','Q','D','C','P','E')),
  responsibility     text,
  origin             text,
  indicator_id       int REFERENCES indicators(id) ON DELETE SET NULL,
  measurement_id     bigint REFERENCES measurements(id) ON DELETE SET NULL,
  typology           text,
  criticality        text,
  subject            text NOT NULL,
  cause              text,
  action             text,
  owner              text,
  priority           text,
  due_date           date,
  status             text NOT NULL DEFAULT 'À faire'
                       CHECK (status IN ('À faire','En cours','Soldée','Abandonnée')),
  pdca               char(1) NOT NULL DEFAULT 'P' CHECK (pdca IN ('P','D','C','A')),
  done_date          date,
  outcome            text,
  escalation_reason  text,
  escalation_answer  text,
  UNIQUE (site_id, num)
);

CREATE TABLE IF NOT EXISTS action_history (
  id         bigserial PRIMARY KEY,
  action_id  int NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  author     text,
  text       text NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id        serial PRIMARY KEY,
  site_id   int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name      text NOT NULL,
  function  text,
  service   text
);

-- Listes paramétrables (typologie, criticité, origine, responsabilité, priorité…).
CREATE TABLE IF NOT EXISTS list_values (
  id       serial PRIMARY KEY,
  site_id  int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind     text NOT NULL,
  value    text NOT NULL,
  ord      int NOT NULL DEFAULT 0,
  UNIQUE (site_id, kind, value)
);

CREATE TABLE IF NOT EXISTS holidays (
  site_id  int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  day      date NOT NULL,
  PRIMARY KEY (site_id, day)
);

-- Utilisateurs connus de l'application (créés à la première connexion).
CREATE TABLE IF NOT EXISTS users (
  email       text PRIMARY KEY,
  name        text,
  role        text NOT NULL DEFAULT 'animateur' CHECK (role IN ('admin','animateur','lecteur')),
  last_login  timestamptz
);
