/**
 * Split a .sql file into single statements. The Neon HTTP driver runs one
 * statement per query, so `;` inside comments, quoted strings and $tag$
 * dollar-quoted bodies must not split.
 */
export function splitStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  const endStatement = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = '';
  };

  while (i < sqlText.length) {
    const rest = sqlText.slice(i);

    if (rest.startsWith('--')) {
      const nl = sqlText.indexOf('\n', i);
      i = nl === -1 ? sqlText.length : nl; // keep the newline
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sqlText.indexOf('*/', i + 2);
      i = end === -1 ? sqlText.length : end + 2;
      continue;
    }

    const dollar = /^\$[A-Za-z_0-9]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sqlText.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sqlText.length : end + tag.length;
      current += sqlText.slice(i, stop);
      i = stop;
      continue;
    }

    if (rest[0] === "'") {
      // '' is an escaped quote inside a literal.
      let j = i + 1;
      while (j < sqlText.length) {
        if (sqlText[j] === "'" && sqlText[j + 1] === "'") j += 2;
        else if (sqlText[j] === "'") break;
        else j++;
      }
      current += sqlText.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (rest[0] === ';') endStatement();
    else current += rest[0];
    i++;
  }
  endStatement();
  return statements;
}
