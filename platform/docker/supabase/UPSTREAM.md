# Vendored Supabase self-hosting stack

Copied unmodified from https://github.com/supabase/supabase/tree/f1b8af12b8019069245266f3546600b37ce06651/docker
(`docker-compose.yml` and the `volumes/api`, `volumes/db`, `volumes/pooler`,
`volumes/functions` directories). Licensed under Apache-2.0 — see `LICENSE.supabase`.

Platform-specific changes live in `../supabase.override.yml`, never in these files, so the
stack can be upgraded by re-copying them from a newer Supabase commit.
