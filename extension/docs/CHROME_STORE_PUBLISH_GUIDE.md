# Guia Completo para Publicar o Enki na Chrome Web Store

Este guia contém o passo a passo completo, checklist de materiais e textos exatos de justificativa para aprovação do Enki na Google Chrome Web Store.

---

## 1. Pré-Requisitos e Conta de Desenvolvedor

1. **Conta Google:** Acesse o [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. **Taxa de Inscrição:** O Google cobra uma taxa única de registro de **$5 USD** (paga uma única vez por cartão de crédito).
3. **Autenticação em Duas Etapas (2FA):** Sua conta Google precisa ter verificação em 2 etapas ativada.

---

## 2. Gerando o Pacote de Produção (ZIP)

O Enki possui um comando automatizado que compila e gera o arquivo ZIP oficial pronto para submissão:

```bash
npm run package
```

- Este comando gera o arquivo: **`release/enki-v0.1.0.zip`**.
- O ZIP contém o `manifest.json` na raiz e todos os arquivos compilados sem código de teste ou dependências desnecessárias.

---

## 3. Materiais Visuais Obrigatórios (Store Assets)

O Google exige imagens específicas para listar a extensão na loja:

| Asset | Dimensões | Formato | Obrigatório? | Observações |
|---|---|---|---|---|
| **Ícone da Loja** | 128 x 128 px | PNG | Sim | Já incluso em `public/icons/icon128.png`. |
| **Capturas de Tela (Screenshots)** | 1280 x 800 px ou 640 x 400 px | PNG ou JPEG | Sim (mínimo 1, recomendado 3-5) | Sem transparência. Mostrando o Side Panel aberto, o modo "Ask", o modo "Act" e as "Configurações". |
| **Promo Tile Pequeno** | 440 x 280 px | PNG ou JPEG | Sim | Banner promocional exibido nas listas e buscas da loja. |
| **Promo Tile Grande (Marquee)** | 1400 x 560 px | PNG ou JPEG | Opcional | Usado pelo Google se sua extensão for selecionada para destaque na home. |

> **Dica para os Screenshots:** Abra o Chrome em 1280x800, abra uma página como GitHub ou Wikipedia, abra o Enki no Side Panel com o tema Dark ou Midnight OLED e tire o print da tela completa.

---

## 4. Política de Privacidade (Privacy Policy)

Como o Enki solicita permissões avançadas (`debugger`, `<all_urls>`), o Google **exige** um link público HTTPS com a política de privacidade.

- Já criamos o arquivo completo em [`docs/PRIVACY_POLICY.md`](PRIVACY_POLICY.md).
- **Opção recomendada:** Use a URL do arquivo no GitHub:
  `https://github.com/devopsfuturasync/enkibrowser/blob/main/docs/PRIVACY_POLICY.md`
  *(Ou ative o GitHub Pages do repositório para ter uma URL formatada).*

---

## 5. Justificativa de Permissões (Crítico para Aprovação)

Durante o envio na aba **"Privacy" / "Privacidade"** do Developer Dashboard, o Google fará perguntas rigorosas sobre o motivo de usar permissões sensíveis. **Copie e cole os textos abaixo:**

### 5.1 Single Purpose (Propósito Único da Extensão)
> **Campo:** *Single Purpose Description*  
> **Texto para colar:**  
> "Enki is an open-source AI browser companion that allows users to analyze web pages, ask questions about page content, and automate repetitive browser navigation tasks using their own LLM API keys via a dedicated side panel."

### 5.2 Justificativa para a permissão `debugger` (CDP)
> **Campo:** *Why does your extension need the 'debugger' permission?*  
> **Texto para colar:**  
> "The 'debugger' permission (Chrome DevTools Protocol) is strictly used in 'Act Mode' to simulate authentic user interactions (mouse clicks, smooth scrolling, and keyboard typing) and to reliably inspect complex dynamic web applications (such as Shadow DOM and dynamic frames). Standard DOM events are often blocked by modern Single Page Apps; CDP ensures reliable input dispatch without compromising user security."

### 5.3 Justificativa para `host_permissions` (`<all_urls>`)
> **Campo:** *Why does your extension need host permissions for all URLs?*  
> **Texto para colar:**  
> "Enki operates as a universal browsing assistant. Users can summon the extension on any website of their choice to summarize content or perform authorized navigation actions. Host permissions are required so Enki can inspect the DOM and capture screenshots on whichever page the user actively navigates to."

### 5.4 Justificativa para `storage`
> **Campo:** *Why does your extension need 'storage'?*  
> **Texto para colar:**  
> "Used exclusively to store user preferences locally (selected theme, LLM model choice, temperature) and encrypted API keys within chrome.storage.local. No sensitive data is transferred to external servers."

### 5.5 Declaração de Coleta de Dados (Data Usage Certification)
No formulário de dados:
- **Do you collect user data?** Selecione **No** para dados pessoais/venda.
- Na seção de conteúdo da página: declare que o conteúdo da página é processado sob demanda e enviado diretamente para o provedor de IA escolhido pelo usuário (`Direct to LLM API`), sem telemetria de terceiros.

---

## 6. Passo a Passo no Developer Console

1. Abra o [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Clique no botão **"New Item" (Novo Item)**.
3. Arraste e solte o arquivo **`release/enki-v0.1.0.zip`**.
4. Na aba **Store Listing**:
   - **Title:** Enki - AI Browser Companion
   - **Summary:** Open-source AI browser assistant. Bring your own model, see the page, let it act.
   - **Category:** Productivity (Produtividade)
   - **Language:** English (ou Português)
   - **Upload de Imagens:** Adicione o ícone 128x128, screenshots e o promo tile 440x280.
5. Na aba **Privacy**:
   - Insira o link da Política de Privacidade.
   - Cole as justificativas de permissões da Seção 5 deste guia.
   - Marque as caixas de conformidade de políticas do desenvolvedor.
6. Clique em **"Submit for Review" (Enviar para Revisão)**.

---

## 7. Prazo de Aprovação e Dicas
- Devido ao uso da permissão `debugger`, a extensão passará por uma **análise manual humana** da equipe do Google.
- O tempo médio de revisão varia de **3 a 7 dias úteis**.
- Se o revisor do Google solicitar um vídeo de demonstração, grave um screencast curto (1 a 2 minutos no YouTube Não-Listado ou Google Drive) mostrando o side panel abrindo, o modo "Ask" respondendo uma dúvida da página, e o modo "Act" navegando com o efeito visual ativado.
