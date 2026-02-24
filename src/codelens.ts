import * as vscode from 'vscode';
import { parseRext } from './parser';

export class RextCodeLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const requests = parseRext(document.getText());

    // Run All lens at the top of the file
    if (requests.length > 1) {
      lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: '▶▶ Run All',
        command: 'rext.runAll'
      }));
    }

    requests.forEach((req, index) => {
      // Encontrar la primera línea con contenido real (saltar ### y vacías)
      let lensLine = req.startLine;
      for (let i = req.startLine; i <= req.endLine; i++) {
        const text = document.lineAt(i).text.trim();
        if (text && !text.startsWith('###') && text !== '---') {
          lensLine = i;
          break;
        }
      }
      const range = new vscode.Range(lensLine, 0, lensLine, 0);
      const title = req.name ? `▶ Run ${req.name}` : '▶ Run Request';
      lenses.push(new vscode.CodeLens(range, {
        title,
        command: 'rext.runCurrentFile',
        arguments: [index]
      }));
      lenses.push(new vscode.CodeLens(range, {
        title: '📋 Export',
        command: 'rext.exportRequest',
        arguments: [index]
      }));
    });

    return lenses;
  }
}