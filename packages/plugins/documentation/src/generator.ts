import { isDataModel, isEnum, isProcedure, isTypeDef } from '@zenstackhq/language/ast';
import type { CliGeneratorContext } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { collectRelationships, isIgnoredModel, resolveRenderOptions } from './extractors';
import { renderEnumPage } from './renderers/enum-page';
import { renderIndexPage } from './renderers/index-page';
import { renderModelPage } from './renderers/model-page';
import { renderRelationshipsPage } from './renderers/relationships-page';
import { renderProcedurePage } from './renderers/procedure-page';
import { renderTypePage } from './renderers/type-page';
import { renderSkillPage } from './renderers/skill-page';
import { renderViewPage } from './renderers/view-page';
import { buildNavList } from './renderers/common';
import type { GenerationContext, PluginOptions } from './types';

function resolvePluginOptions(raw: Record<string, unknown>): PluginOptions {
    return {
        output: typeof raw['output'] === 'string' ? raw['output'] : undefined,
        title: typeof raw['title'] === 'string' ? raw['title'] : undefined,
        fieldOrder: raw['fieldOrder'] === 'alphabetical' ? 'alphabetical' : 'declaration',
        includeInternalModels: raw['includeInternalModels'] === true,
        includeRelationships: raw['includeRelationships'] !== false,
        includePolicies: raw['includePolicies'] !== false,
        includeValidation: raw['includeValidation'] !== false,
        includeIndexes: raw['includeIndexes'] !== false,
        generateSkill: raw['generateSkill'] === true,
    };
}

function resolveOutputDir(opts: PluginOptions, defaultPath: string): string {
    return path.resolve(opts.output ?? defaultPath);
}

/**
 * Main entry point for the documentation generator plugin.
 * Reads the ZModel AST from `context`, renders markdown pages for every entity,
 * and writes them into the configured output directory.
 */
export function generate(context: CliGeneratorContext): void {
    const startTime = performance.now();
    const pluginOpts = resolvePluginOptions(context.pluginOptions);
    const outputDir = resolveOutputDir(pluginOpts, context.defaultOutputPath);
    const options = resolveRenderOptions(pluginOpts);
    options.schemaDir = path.dirname(path.resolve(context.schemaFile));

    const genCtx: GenerationContext = {
        schemaFile: path.basename(context.schemaFile),
        generatedAt: new Date().toISOString().split('T')[0]!,
    };
    options.genCtx = genCtx;

    try {
        fs.mkdirSync(outputDir, { recursive: true });
    } catch (err) {
        throw new Error(`Failed to create output directory "${outputDir}": ${err instanceof Error ? err.message : String(err)}`);
    }

    let filesGenerated = 0;

    const modelsDir = path.join(outputDir, 'models');
    const allDataModels = context.model.declarations
        .filter(isDataModel)
        .filter((m) => pluginOpts.includeInternalModels || !isIgnoredModel(m));

    const models = allDataModels.filter((m) => !m.isView);
    const views = allDataModels.filter((m) => m.isView);

    const procedures = context.model.declarations.filter(isProcedure);

    const allRelations = collectRelationships(models);
    const hasRelationships = options.includeRelationships && allRelations.length > 0;

    if (models.length > 0) {
        fs.mkdirSync(modelsDir, { recursive: true });
        const sortedModels = [...models].sort((a, b) => a.name.localeCompare(b.name));
        const modelNav = buildNavList(sortedModels.map((m) => m.name), './');

        for (const model of sortedModels) {
            writeFile(
                path.join(modelsDir, `${model.name}.md`),
                renderModelPage({ model, options, procedures, navigation: modelNav.get(model.name) }),
            );
            filesGenerated++;
        }
    }

    const viewsDir = path.join(outputDir, 'views');
    if (views.length > 0) {
        fs.mkdirSync(viewsDir, { recursive: true });
        const sortedViews = [...views].sort((a, b) => a.name.localeCompare(b.name));
        const viewNav = buildNavList(sortedViews.map((v) => v.name), './');
        for (const view of sortedViews) {
            writeFile(
                path.join(viewsDir, `${view.name}.md`),
                renderViewPage({ view, options, navigation: viewNav.get(view.name) }),
            );
            filesGenerated++;
        }
    }

    if (hasRelationships) {
        writeFile(
            path.join(outputDir, 'relationships.md'),
            renderRelationshipsPage({ relations: allRelations, genCtx }),
        );
        filesGenerated++;
    }

    const typesDir = path.join(outputDir, 'types');
    const typeDefs = context.model.declarations.filter(isTypeDef);
    if (typeDefs.length > 0) {
        fs.mkdirSync(typesDir, { recursive: true });
        const sortedTypes = [...typeDefs].sort((a, b) => a.name.localeCompare(b.name));
        const typeNav = buildNavList(sortedTypes.map((t) => t.name), './');
        for (const typeDef of sortedTypes) {
            writeFile(
                path.join(typesDir, `${typeDef.name}.md`),
                renderTypePage({ typeDef, allModels: [...models, ...views], options, navigation: typeNav.get(typeDef.name) }),
            );
            filesGenerated++;
        }
    }

    const enumsDir = path.join(outputDir, 'enums');
    const enums = context.model.declarations.filter(isEnum);
    if (enums.length > 0) {
        fs.mkdirSync(enumsDir, { recursive: true });
        const sortedEnums = [...enums].sort((a, b) => a.name.localeCompare(b.name));
        const enumNav = buildNavList(sortedEnums.map((e) => e.name), './');
        for (const enumDecl of sortedEnums) {
            writeFile(
                path.join(enumsDir, `${enumDecl.name}.md`),
                renderEnumPage({ enumDecl, allModels: models, options, navigation: enumNav.get(enumDecl.name) }),
            );
            filesGenerated++;
        }
    }

    const proceduresDir = path.join(outputDir, 'procedures');
    if (procedures.length > 0) {
        fs.mkdirSync(proceduresDir, { recursive: true });
        const sortedProcs = [...procedures].sort((a, b) => a.name.localeCompare(b.name));
        const procNav = buildNavList(sortedProcs.map((p) => p.name), './');
        for (const proc of sortedProcs) {
            writeFile(
                path.join(proceduresDir, `${proc.name}.md`),
                renderProcedurePage({ proc, options, navigation: procNav.get(proc.name) }),
            );
            filesGenerated++;
        }
    }

    if (pluginOpts.generateSkill) {
        writeFile(
            path.join(outputDir, 'SKILL.md'),
            renderSkillPage({
                schema: context.model,
                title: pluginOpts.title ?? 'Schema Documentation',
                models, views, enums, typeDefs, procedures, hasRelationships,
            }),
        );
        filesGenerated++;
    }

    filesGenerated++;
    genCtx.durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    genCtx.filesGenerated = filesGenerated;

    writeFile(
        path.join(outputDir, 'index.md'),
        renderIndexPage({ astModel: context.model, pluginOptions: pluginOpts, hasRelationships, genCtx }),
    );
}

function writeFile(filePath: string, content: string): void {
    try {
        fs.writeFileSync(filePath, content);
    } catch (err) {
        throw new Error(`Failed to write "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
    }
}
