//! JSX attribute scanner + patcher (spec 7.4: GUI edits only touch explicit, literal props of elements that carry an `id`).
//! This is a purpose-built scanner, not a full TypeScript parser: it locates `<Component attr=...>` tags and
//! rewrites exactly one attribute value; everything else in the file is left byte-for-byte untouched.
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind { Str, Num, Expr, Bool }

#[derive(Debug, Clone, Serialize)]
pub struct Attr {
    pub name: String, pub kind: Kind, pub value: String,
    #[serde(skip)] pub span: (usize, usize),
}
#[derive(Debug, Clone, Serialize)]
pub struct Element {
    pub tag: String, pub id: Option<String>, pub line: usize,
    /// Props named in `editable={{ a: true, b: true }}` (spec 7.4); None when the element has no editable metadata.
    pub editable: Option<Vec<String>>, pub attrs: Vec<Attr>,
    #[serde(skip)] pub name_end: usize,
}

fn is_ident(c: u8) -> bool { c.is_ascii_alphanumeric() || c == b'_' || c == b'$' }
fn skip_string(b: &[u8], i: usize) -> usize {
    let q = b[i]; let mut j = i + 1;
    while j < b.len() { if b[j] == b'\\' { j += 2 } else if b[j] == q { return j + 1 } else { j += 1 } }
    b.len()
}
/// `b[i] == '{'` -> index just past the matching '}' (strings, template literals and comments are skipped).
fn skip_braces(b: &[u8], i: usize) -> usize {
    let (mut depth, mut j) = (0i32, i);
    while j < b.len() {
        match b[j] {
            b'{' => { depth += 1; j += 1 }
            b'}' => { depth -= 1; j += 1; if depth == 0 { return j } }
            b'"' | b'\'' | b'`' => j = skip_string(b, j),
            b'/' if b.get(j + 1) == Some(&b'/') => { while j < b.len() && b[j] != b'\n' { j += 1 } }
            b'/' if b.get(j + 1) == Some(&b'*') => { j += 2; while j + 1 < b.len() && !(b[j] == b'*' && b[j + 1] == b'/') { j += 1 } j += 2 }
            _ => j += 1,
        }
    }
    b.len()
}
fn classify_braced(inner: &str) -> (Kind, String) {
    let t = inner.trim();
    if !t.is_empty() && t.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E')) && t.parse::<f64>().is_ok() {
        return (Kind::Num, t.to_string());
    }
    let tb = t.as_bytes();
    if tb.len() >= 2 && (tb[0] == b'"' || tb[0] == b'\'') && skip_string(tb, 0) == tb.len() {
        let v = if tb[0] == b'"' { serde_json::from_str::<String>(t).unwrap_or_else(|_| t[1..t.len() - 1].to_string()) } else { t[1..t.len() - 1].to_string() };
        return (Kind::Str, v);
    }
    (Kind::Expr, t.to_string())
}

pub fn scan(text: &str) -> Vec<Element> {
    let b = text.as_bytes(); let mut out = vec![]; let mut i = 0;
    while i < b.len() {
        if b[i] == b'/' && b.get(i + 1) == Some(&b'/') && (i == 0 || b[i - 1].is_ascii_whitespace()) { while i < b.len() && b[i] != b'\n' { i += 1 } continue; }
        if b[i] == b'/' && b.get(i + 1) == Some(&b'*') { i += 2; while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') { i += 1 } i += 2; continue; }
        // `<Component` directly after a non-identifier char (so generics like useState<Foo> are not matched)
        if b[i] == b'<' && b.get(i + 1).map_or(false, |c| c.is_ascii_uppercase()) && (i == 0 || !is_ident(b[i - 1])) {
            let mut j = i + 1;
            while j < b.len() && (is_ident(b[j]) || b[j] == b'.') { j += 1 }
            let mut el = Element { tag: text[i + 1..j].to_string(), id: None, line: text[..i].matches('\n').count() + 1, editable: None, attrs: vec![], name_end: j };
            loop {
                while j < b.len() && b[j].is_ascii_whitespace() { j += 1 }
                if j >= b.len() || b[j] == b'>' { break }
                if b[j] == b'/' { j += 1; continue }
                if b[j] == b'{' { j = skip_braces(b, j); continue } // {...spread}
                if !(is_ident(b[j]) || b[j] == b'-' || b[j] == b':') { break }
                let s = j; while j < b.len() && (is_ident(b[j]) || b[j] == b'-' || b[j] == b':') { j += 1 }
                let name = text[s..j].to_string();
                if b.get(j) != Some(&b'=') { el.attrs.push(Attr { name, kind: Kind::Bool, value: "true".into(), span: (s, j) }); continue }
                j += 1;
                match b.get(j) {
                    Some(b'"') | Some(b'\'') => { let e = skip_string(b, j); el.attrs.push(Attr { name, kind: Kind::Str, value: text[j + 1..e - 1].to_string(), span: (j, e) }); j = e }
                    Some(b'{') => { let e = skip_braces(b, j); let (kind, value) = classify_braced(&text[j + 1..e - 1]); el.attrs.push(Attr { name, kind, value, span: (j, e) }); j = e }
                    _ => break,
                }
            }
            el.editable = el.attrs.iter().find(|a| a.name == "editable" && a.kind == Kind::Expr).map(|a| parse_editable(&a.value));
            el.id = el.attrs.iter().find(|a| a.name == "id" && a.kind == Kind::Str).map(|a| a.value.clone());
            out.push(el);
            i = el_end(&out, i); continue;
        }
        i += 1;
    }
    out
}
// continue scanning right after the tag name so nested elements and JSX inside attribute expressions are found too
fn el_end(out: &[Element], _i: usize) -> usize { out.last().unwrap().name_end }

/// `{ text: true, "fontSize": true, y: false }` -> ["text", "fontSize"]
fn parse_editable(obj: &str) -> Vec<String> {
    let t = obj.trim().trim_start_matches('{').trim_end_matches('}');
    t.split(',').filter_map(|kv| { let (k, v) = kv.split_once(':')?; (v.trim() == "true").then(|| k.trim().trim_matches(|c| c == '"' || c == '\'').to_string()) }).collect()
}

fn literal(v: &Value) -> Result<String, String> {
    match v {
        Value::Number(n) => { let f = n.as_f64().ok_or("bad number")?; if !f.is_finite() { return Err("number must be finite".into()) }
            Ok(if f.fract() == 0.0 && f.abs() < 1e15 { format!("{{{}}}", f as i64) } else { format!("{{{f}}}") }) }
        Value::String(s) => Ok(if s.contains(['"', '\\', '\n', '\r']) { format!("{{{}}}", serde_json::to_string(s).unwrap()) } else { format!("\"{s}\"") }),
        _ => Err("value must be a number or a string".into()),
    }
}

/// Set one prop on the element with the given `id`. Expression props are read-only; missing props are inserted.
pub fn set_prop(text: &str, id: &str, prop: &str, value: &Value) -> Result<String, String> {
    if prop == "id" { return Err("id is not editable".into()) }
    if prop.is_empty() || !prop.bytes().all(|c| is_ident(c)) { return Err(format!("invalid prop name: {prop}")) }
    let els = scan(text);
    let mut hits = els.iter().filter(|e| e.id.as_deref() == Some(id));
    let el = hits.next().ok_or_else(|| format!("no element with id \"{id}\""))?;
    if hits.next().is_some() { return Err(format!("duplicate id \"{id}\"; ids must be unique")) }
    if !el.editable.as_ref().map_or(false, |l| l.iter().any(|n| n == prop)) {
        return Err(format!("{id}.{prop} is not marked editable (add `{prop}: true` to editable={{{{ ... }}}} in the source)"));
    }
    let lit = literal(value)?;
    match el.attrs.iter().find(|a| a.name == prop) {
        Some(a) if matches!(a.kind, Kind::Expr | Kind::Bool) => Err(format!("{id}.{prop} is {} (read-only in the GUI): {}", if a.kind == Kind::Expr { "an expression" } else { "a boolean flag" }, a.value)),
        Some(a) => Ok(format!("{}{}{}", &text[..a.span.0], lit, &text[a.span.1..])),
        None => Ok(format!("{} {prop}={lit}{}", &text[..el.name_end], &text[el.name_end..])),
    }
}

/// Apply several prop edits to one element; all-or-nothing (an Err means the input text was not touched).
pub fn set_props(text: &str, id: &str, props: &[(String, Value)]) -> Result<String, String> {
    let mut t = text.to_string();
    for (k, v) in props { t = set_prop(&t, id, k, v)?; }
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*; use serde_json::json;
    const SRC: &str = r#"const [s] = useState<Foo>(1);
function T(){ return <Text id="title" editable={{ text: true, fontSize: true, opacity: true, color: true }} text="Hi" fontSize={80} opacity={interpolate(f, [0, 30], [0, 1])} onClick={() => a > b} /> }
<Shape id="bar" fill='#fff' width={10.5} {...rest} />
<Shape id="bar" />"#;
    #[test] fn scans_kinds_and_ignores_generics() {
        let e = scan(SRC); assert_eq!(e.len(), 3, "{e:?}");
        let k: Vec<_> = e[0].attrs.iter().map(|a| (a.name.as_str(), a.kind.clone())).collect();
        assert_eq!(k, vec![("id", Kind::Str), ("editable", Kind::Expr), ("text", Kind::Str), ("fontSize", Kind::Num), ("opacity", Kind::Expr), ("onClick", Kind::Expr)]);
        assert_eq!(e[1].attrs.iter().find(|a| a.name == "width").unwrap().value, "10.5");
    }
    #[test] fn patches_number_and_string_only_that_prop() {
        let o = set_prop(SRC, "title", "fontSize", &json!(120)).unwrap();
        assert_eq!(o, SRC.replace("fontSize={80}", "fontSize={120}"));
        let o = set_prop(SRC, "title", "text", &json!("Hello \"Q\"")).unwrap();
        assert!(o.contains(r#"text={"Hello \"Q\""}"#));
    }
    #[test] fn expression_is_read_only() {
        let e = set_prop(SRC, "title", "opacity", &json!(1)).unwrap_err(); assert!(e.contains("expression"), "{e}");
    }
    #[test] fn inserts_missing_prop_and_rejects_bad_input() {
        let o = set_prop(SRC, "title", "color", &json!("#ff0000")).unwrap(); assert!(o.contains(r##"<Text color="#ff0000" id="title""##));
        assert!(set_prop(SRC, "nope", "x", &json!(1)).is_err());
        assert!(set_prop(SRC, "bar", "x", &json!(1)).unwrap_err().contains("duplicate"));
        assert!(set_prop(SRC, "title", "id", &json!("x")).is_err());
        assert!(set_prop(SRC, "title", "a b", &json!(1)).is_err());
        assert!(set_prop(SRC, "title", "x", &json!(null)).is_err());
    }
    #[test] fn only_editable_props_can_be_set() {
        let e = set_prop(SRC, "title", "onClick", &json!(1)).unwrap_err(); assert!(e.contains("not marked editable"), "{e}");
        let src = "<Text id=\"a\" fontSize={1} />"; // no editable metadata at all
        assert!(set_prop(src, "a", "fontSize", &json!(2)).unwrap_err().contains("not marked editable"));
        assert_eq!(scan(SRC)[0].editable.as_deref(), Some(&["text".to_string(), "fontSize".into(), "opacity".into(), "color".into()][..]));
        assert_eq!(parse_editable("{ \"x\": true, y: false, z:true }"), vec!["x", "z"]);
    }
    #[test] fn set_props_is_all_or_nothing() {
        let src = "<Sequence id=\"s\" editable={{ from: true, durationInFrames: true }} from={10} durationInFrames={60}>";
        let ok = set_props(src, "s", &[("from".into(), json!(20)), ("durationInFrames".into(), json!(45))]).unwrap();
        assert!(ok.contains("from={20}") && ok.contains("durationInFrames={45}"));
        assert!(set_props(src, "s", &[("from".into(), json!(20)), ("x".into(), json!(1))]).is_err());
    }
    #[test] fn skips_commented_out_jsx() {
        assert_eq!(scan("// <Text id=\"a\" />\n/* <Text id=\"b\" /> */\n<Text id=\"c\" />").len(), 1);
    }
}
