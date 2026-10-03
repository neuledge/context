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

export function generateIngestionRevision(root = repository) {
  const files = new Map();
  const dependencies = new Map();
  const lock = parse(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"));

  function dependency(name, version) {
    const key = `${name}@${version}`;
    if (dependencies.has(key)) return;
    const snapshot = lock.snapshots[key];
    const packageKey = key.replace(/\(.*$/, "");
    const pkg = lock.packages[packageKey];
    if (!snapshot || !pkg)
      throw new Error(`Missing locked ingestion dependency: ${key}`);
    dependencies.set(key, { package: pkg, snapshot });
    for (const [child, childVersion] of Object.entries({
      ...snapshot.dependencies,
      ...snapshot.optionalDependencies,
    })) {
      dependency(child, childVersion);
    }
  }

  function follow(file, specifier, names) {
    if (specifier.startsWith("node:")) return;
    if (specifier.startsWith(".")) {
      visit(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      return;
    }
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (packageName === "@neuledge/context") {
      // Resolve the APIs actually imported from the workspace barrel. Changes
      // to the CLI or server must not invalidate documentation packages.
      const index = resolve(root, "packages/context/src/index.ts");
      if (specifier !== packageName) {
        visit(
          resolve(
            root,
            "packages/context/src",
            specifier.slice(packageName.length + 1).replace(/\.js$/, ".ts"),
          ),
        );
        return;
      }
      const source = ts.createSourceFile(
        index,
        readFileSync(index, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const unresolved = names && new Set(names);
      for (const statement of source.statements) {
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
        if (
          !names ||
          !exported ||
          exported.some((name) => names.includes(name))
        ) {
          follow(index, statement.moduleSpecifier.text);
          for (const name of exported ?? []) unresolved?.delete(name);
        }
      }
      if (unresolved?.size)
        throw new Error(
          `Unresolved ingestion exports: ${[...unresolved].join(", ")}`,
        );
      return;
    }
    const importer = relative(root, file)
      .replaceAll("\\", "/")
      .split("/")
      .slice(0, 2)
      .join("/");
    const manifest = lock.importers[importer];
    const entry =
      manifest.dependencies?.[packageName] ??
      manifest.optionalDependencies?.[packageName];
    if (!entry)
      throw new Error(
        `Undeclared ingestion dependency: ${packageName} in ${file}`,
      );
    dependency(packageName, entry.version);
  }

  function visit(file) {
    const path = relative(root, file).replaceAll("\\", "/");
    if (files.has(path)) return;
    const content = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    files.set(path, content);
    const source = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    function walk(node) {
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
        follow(file, node.moduleSpecifier.text, names);
      } else if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier
      ) {
        follow(file, node.moduleSpecifier.text);
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
          follow(file, node.arguments[0].text);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }

  visit(resolve(root, "packages/registry/src/build.ts"));
  dependency(
    "typescript",
    lock.importers["packages/registry"].devDependencies.typescript.version,
  );
  // Include the algorithm itself so changes in what we hash also invalidate.
  files.set(
    "scripts/generate-ingestion-revision.mjs",
    readFileSync(scriptPath, "utf8").replaceAll("\r\n", "\n"),
  );
  const inputs = canonical({
    files: Object.fromEntries(files),
    dependencies: Object.fromEntries(dependencies),
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
