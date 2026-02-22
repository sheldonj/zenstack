import { isEnum, type DataModel, type Enum } from '@zenstackhq/language/ast';
import { getAllFields } from '@zenstackhq/language/utils';
import { getRelativeSourcePath, stripCommentPrefix } from '../extractors';
import type { EnumPageProps } from '../types';
import { breadcrumbs, declarationBlock, generatedHeader, navigationFooter, referencesSection, renderDescription, sectionHeading } from './common';

interface EnumUsage {
    modelName: string;
    fieldNames: string[];
}

function collectEnumUsage(enumDecl: Enum, allModels: DataModel[]): EnumUsage[] {
    const usages: EnumUsage[] = [];
    for (const m of allModels) {
        const fields = getAllFields(m)
            .filter(
                (f) =>
                    f.type.reference?.ref &&
                    isEnum(f.type.reference.ref) &&
                    f.type.reference.ref.name === enumDecl.name,
            )
            .map((f) => f.name);
        if (fields.length > 0) {
            usages.push({ modelName: m.name, fieldNames: fields });
        }
    }
    return usages.sort((a, b) => a.modelName.localeCompare(b.modelName));
}

function renderHeader(props: EnumPageProps): string[] {
    return [
        ...generatedHeader(props.options.genCtx),
        breadcrumbs('Enums', props.enumDecl.name, '../'),
        '',
        `# ${props.enumDecl.name} <kbd>Enum</kbd>`,
        '',
    ];
}

function renderSourceAndDeclaration(props: EnumPageProps): string[] {
    const sourcePath = getRelativeSourcePath(props.enumDecl, props.options.schemaDir);
    const lines: string[] = [];
    if (sourcePath) {
        lines.push(`**Defined in:** \`${sourcePath}\``, '');
    }
    lines.push(...declarationBlock(props.enumDecl.$cstNode?.text, sourcePath));
    return lines;
}

function renderValuesSection(enumDecl: Enum): string[] {
    if (enumDecl.fields.length === 0) return [];
    const lines = [...sectionHeading('Values'), '', '| Value | Description |', '| --- | --- |'];
    for (const field of enumDecl.fields) {
        const fieldDesc = stripCommentPrefix(field.comments) || '—';
        lines.push(`| \`${field.name}\` | ${fieldDesc} |`);
    }
    lines.push('');
    return lines;
}

function renderUsedBySection(enumDecl: Enum, usages: EnumUsage[]): string[] {
    if (usages.length === 0) return [];
    const lines = [...sectionHeading('Used By'), ''];
    for (const { modelName, fieldNames } of usages) {
        const fieldLinks = fieldNames
            .map((f) => `[\`${f}\`](../models/${modelName}.md#field-${f})`)
            .join(', ');
        lines.push(`- [${modelName}](../models/${modelName}.md) — ${fieldLinks}`);
    }
    lines.push('');
    return lines;
}

function renderUsageDiagram(enumDecl: Enum, usages: EnumUsage[]): string[] {
    if (usages.length === 0) return [];
    const lines = ['```mermaid', 'classDiagram', `    class ${enumDecl.name} {`, `        <<enumeration>>`];
    for (const field of enumDecl.fields) {
        lines.push(`        ${field.name}`);
    }
    lines.push('    }');
    for (const { modelName, fieldNames } of usages) {
        lines.push(`    ${modelName} --> ${enumDecl.name} : ${fieldNames.join(', ')}`);
    }
    lines.push('```', '');
    return lines;
}

/** Renders a full documentation page for an enum, including values, usage, and a class diagram. */
export function renderEnumPage(props: EnumPageProps): string {
    const usages = collectEnumUsage(props.enumDecl, props.allModels);

    return [
        ...renderHeader(props),
        ...renderDescription(props.enumDecl.comments, stripCommentPrefix),
        ...renderSourceAndDeclaration(props),
        ...renderValuesSection(props.enumDecl),
        ...renderUsedBySection(props.enumDecl, usages),
        ...renderUsageDiagram(props.enumDecl, usages),
        ...referencesSection('enum'),
        ...navigationFooter(props.navigation),
    ].join('\n');
}
