-- One shared name per project (ADR 0028): the alias name:<slug> a level may bind a project to,
-- the other name a team can match it by beside a host-led git remote. The prefix is matched
-- by substr, never LIKE, so no case folding lets a second `Name:` row through.
CREATE UNIQUE INDEX project_aliases_one_name ON project_aliases(project_id) WHERE substr(alias, 1, 5) = 'name:';
