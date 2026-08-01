/** Minimal CSV parse (handles quoted fields). */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.length);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = parseLine(lines[0]!);
  const rows = lines.slice(1).map(parseLine).filter((r) => r.some((c) => c.length > 0));
  return { headers, rows };
}

export function guessFieldMapping(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const h of headers) {
    const n = norm(h);
    if (["phone", "mobile", "cell", "phonenumber", "telephone"].includes(n)) {
      map[h] = "phone";
    } else if (["firstname", "first", "fname"].includes(n)) {
      map[h] = "first_name";
    } else if (["lastname", "last", "lname"].includes(n)) {
      map[h] = "last_name";
    } else if (["company", "companyname", "org", "organization"].includes(n)) {
      map[h] = "company";
    } else if (["email", "emailaddress"].includes(n)) {
      map[h] = "email";
    } else {
      map[h] = `custom:${h}`;
    }
  }
  return map;
}
