-- Recon's data: one row per document. `collection` is "<store>/<kind>" (for example "team-52111a/matches"), the team
-- registry is "_registry", and `json` holds the document.
CREATE TABLE IF NOT EXISTS docs (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  json       TEXT NOT NULL,
  PRIMARY KEY (collection, id)
) WITHOUT ROWID;
