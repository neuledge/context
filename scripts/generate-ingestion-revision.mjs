/** Build-time fingerprint of ingestion modules and their locked runtime dependencies. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repository = resolve(dirname(scriptPath), "..");
const require = createRequire(
  resolve(repository, "packages/registry/package.json"),
);
const ts = require("typescript");
const { parse } = require("yaml");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function lockedDependency(state, name, version) {
  const key = `${name}@${version}`;
  if (state.dependencies.has(key)) return;
  const snapshot = state.lock.snapshots[key];
  // pnpm snapshots retain peer suffixes; package records normally omit them.
  // Also accept suffix-bearing package records rather than assuming one layout.
  const pkg =
    state.lock.packages[key] ?? state.lock.packages[key.replace(/\(.*$/, "")];
  if (!snapshot || !pkg)
    throw new Error(`Missing locked ingestion dependency: ${key}`);
  state.dependencies.set(key, { package: pkg, snapshot });
  for (const [child, childVersion] of Object.entries({
    ...snapshot.dependencies,
    ...snapshot.optionalDependencies,
  })) {
    lockedDependency(state, child, childVersion);
  }
}

function sourceFile(file, content = readFileSync(file, "utf8")) {
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
}

function followContextExports(state, names) {
  const index = resolve(state.root, "packages/context/src/index.ts");
  const unresolved = names && new Set(names);
  for (const statement of sourceFile(index).statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.moduleSpecifier
    )
      continue;
    const exported =
      statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements
            .filter((item) => !item.isTypeOnly)
            .map((item) => item.name.text)
        : undefined;
    if (!names || !exported || exported.some((name) => names.includes(name))) {
      followImport(state, index, statement.moduleSpecifier.text);
      for (const name of exported ?? []) unresolved?.delete(name);
    }
  }
  if (unresolved?.size)
    throw new Error(
      `Unresolved ingestion exports: ${[...unresolved].join(", ")}`,
    );
}

function followImport(state, file, specifier, names) {
  if (specifier.startsWith("node:")) return;
  if (specifier.startsWith(".")) {
    visitSource(
      state,
      resolve(dirname(file), specifier.replace(/\.js$/, ".ts")),
    );
    return;
  }
  const packageName = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  if (packageName === "@neuledge/context") {
    if (specifier === packageName) {
      followContextExports(state, names);
    } else {
      visitSource(
        state,
        resolve(
          state.root,
          "packages/context/src",
          specifier.slice(packageName.length + 1).replace(/\.js$/, ".ts"),
        ),
      );
    }
    return;
  }
  const importer = relative(state.root, file)
    .replaceAll("\\", "/")
    .split("/")
    .slice(0, 2)
    .join("/");
  const manifest = state.lock.importers[importer];
  const entry =
    manifest.dependencies?.[packageName] ??
    manifest.optionalDependencies?.[packageName];
  if (!entry)
    throw new Error(
      `Undeclared ingestion dependency: ${packageName} in ${file}`,
    );
  lockedDependency(state, packageName, entry.version);
}

function visitNode(state, file, source, node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause?.isTypeOnly) return;
    const bindings = clause?.namedBindings;
    const names =
      bindings && ts.isNamedImports(bindings)
        ? bindings.elements
            .filter((item) => !item.isTypeOnly)
            .map((item) => (item.propertyName ?? item.name).text)
        : undefined;
    if (names?.length === 0 && !clause?.name) return;
    followImport(state, file, node.moduleSpecifier.text, names);
  } else if (
    ts.isExportDeclaration(node) &&
    !node.isTypeOnly &&
    node.moduleSpecifier
  ) {
    followImport(state, file, node.moduleSpecifier.text);
  } else if (
    ts.isCallExpression(node) &&
    node.arguments[0] &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    const expression = node.expression.getText(source);
    if (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      /^(?:_?require)(?:\.resolve)?$/.test(expression)
    ) {
      followImport(state, file, node.arguments[0].text);
    }
  }
  ts.forEachChild(node, (child) => visitNode(state, file, source, child));
}

function visitSource(state, file) {
  const path = relative(state.root, file).replaceAll("\\", "/");
  if (state.files.has(path)) return;
  const content = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  state.files.set(path, content);
  const source = sourceFile(file, content);
  visitNode(state, file, source, source);
}

export function generateIngestionRevision(root = repository) {
  const state = {
    root,
    files: new Map(),
    dependencies: new Map(),
    lock: parse(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8")),
  };
  visitSource(state, resolve(root, "packages/registry/src/build.ts"));
  lockedDependency(
    state,
    "typescript",
    state.lock.importers["packages/registry"].devDependencies.typescript
      .version,
  );
  // Include the algorithm itself so changes in what we hash also invalidate.
  state.files.set(
    "scripts/generate-ingestion-revision.mjs",
    readFileSync(scriptPath, "utf8").replaceAll("\r\n", "\n"),
  );
  const inputs = canonical({
    files: Object.fromEntries(state.files),
    dependencies: Object.fromEntries(state.dependencies),
  });
  return {
    revision: createHash("sha256").update(JSON.stringify(inputs)).digest("hex"),
    files: Object.keys(inputs.files),
    dependencies: Object.keys(inputs.dependencies),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = process.argv[2] ? resolve(process.argv[2]) : repository;
  const output = resolve(root, "packages/registry/dist");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "ingestion-revision.json"),
    `${JSON.stringify(generateIngestionRevision(root), null, 2)}\n`,
  );
}
