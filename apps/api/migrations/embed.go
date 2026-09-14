// Package migrations embeds the SQL migration files into the API binary so the same
// artifact can migrate any environment without shipping loose files.
//
// Files follow golang-migrate naming: NNNNNN_description.{up,down}.sql.
// Create a new pair with:  make migrate-create name=add_something
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
