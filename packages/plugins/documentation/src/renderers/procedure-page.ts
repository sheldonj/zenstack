import { isDataModel, isEnum, type FunctionParamType, type Procedure } from '@zenstackhq/language/ast';
import { extractProcedureComments, getRelativeSourcePath } from '../extractors';
import type { ProcedurePageProps } from '../types';
import { breadcrumbs, declarationBlock, generatedHeader, navigationFooter, referencesSection, sectionHeading } from './common';

function formatParamType(paramType: FunctionParamType, linked: boolean): string {
    let typeName: string;

    if (paramType.reference?.ref) {
        const ref = paramType.reference.ref;
        if (linked) {
            if (isDataModel(ref)) {
                typeName = `[${ref.name}](../models/${ref.name}.md)`;
            } else if (isEnum(ref)) {
                typeName = `[${ref.name}](../enums/${ref.name}.md)`;
            } else {
                typeName = `[${ref.name}](../types/${ref.name}.md)`;
            }
        } else {
            typeName = ref.name;
        }
    } else if (paramType.type) {
        typeName = `\`${paramType.type}\``;
    } else {
        typeName = 'Unknown';
    }

    if (paramType.array) typeName += '[]';
    return typeName;
}

function renderHeader(props: ProcedurePageProps): string[] {
    return [
        ...generatedHeader(props.options.genCtx),
        breadcrumbs('Procedures', props.proc.name, '../'),
        '',
        `# ${props.proc.name} <kbd>${props.proc.mutation ? 'Mutation' : 'Query'}</kbd>`,
        '',
    ];
}

function renderProcDescription(proc: Procedure): string[] {
    const description = extractProcedureComments(proc);
    if (!description) return [];
    const lines: string[] = [];
    for (const descLine of description.split('\n')) {
        lines.push(`> ${descLine}`);
    }
    lines.push('');
    return lines;
}

function renderSourceAndDeclaration(props: ProcedurePageProps): string[] {
    const sourcePath = getRelativeSourcePath(props.proc, props.options.schemaDir);
    const lines: string[] = [];
    if (sourcePath) {
        lines.push(`**Defined in:** \`${sourcePath}\``, '');
    }
    lines.push(...declarationBlock(props.proc.$cstNode?.text, sourcePath));
    return lines;
}

function renderParametersSection(proc: Procedure): string[] {
    if (proc.params.length === 0) return [];
    const lines = [
        ...sectionHeading('Parameters'), '',
        '| Parameter | Type | Required |',
        '| --- | --- | --- |',
    ];
    for (const param of proc.params) {
        lines.push(`| \`${param.name}\` | ${formatParamType(param.type, true)} | ${!param.optional ? 'Yes' : 'No'} |`);
    }
    lines.push('');
    return lines;
}

function renderReturnsSection(proc: Procedure): string[] {
    return [...sectionHeading('Returns'), '', formatParamType(proc.returnType, true), ''];
}

function renderFlowDiagram(proc: Procedure): string[] {
    const lines = ['```mermaid', 'flowchart LR'];
    const procNodeId = `proc["${proc.name}"]`;
    if (proc.params.length > 0) {
        for (const param of proc.params) {
            const typeName = param.type.reference?.ref?.name ?? param.type.type ?? 'Unknown';
            const suffix = param.optional ? '?' : '';
            const arrayMark = param.type.array ? '[]' : '';
            lines.push(`    ${param.name}["${param.name}: ${typeName}${arrayMark}${suffix}"] --> ${procNodeId}`);
        }
    } else {
        lines.push(`    input((" ")) --> ${procNodeId}`);
    }
    const retTypeName = proc.returnType.reference?.ref?.name ?? proc.returnType.type ?? 'Unknown';
    const retArray = proc.returnType.array ? '[]' : '';
    lines.push(`    ${procNodeId} --> ret["${retTypeName}${retArray}"]`);
    lines.push('```', '');
    return lines;
}

/** Renders a full documentation page for a procedure declaration. */
export function renderProcedurePage(props: ProcedurePageProps): string {
    return [
        ...renderHeader(props),
        ...renderProcDescription(props.proc),
        ...renderSourceAndDeclaration(props),
        ...renderParametersSection(props.proc),
        ...renderReturnsSection(props.proc),
        ...renderFlowDiagram(props.proc),
        ...referencesSection('procedure'),
        ...navigationFooter(props.navigation),
    ].join('\n');
}
