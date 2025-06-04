const j = require('jscodeshift');

// Explicitly use TypeScript parser
module.exports.parser = 'tsx';

module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Helper to wrap text children in a specified component
  function wrapTextChildren(children, wrapperName, parentName) {
    if (!children || !Array.isArray(children)) return [];
    // Skip wrapping if parent is Text or Heading
    if (['Text', 'Heading'].includes(parentName)) return children;
    return children
      .map(child => {
        // Skip if child is already a Text or Heading element
        if (
          child.type === 'JSXElement' &&
          child.openingElement.name.type === 'JSXIdentifier' &&
          ['Text', 'Heading'].includes(child.openingElement.name.name)
        ) {
          return child;
        }
        if (child.type === 'JSXText' && child.value.trim() !== '') {
          const cleanedValue = child.value.replace(/[()[\]]/g, '').trim();
          if (cleanedValue) {
            return j.jsxElement(
              j.jsxOpeningElement(j.jsxIdentifier(wrapperName)),
              j.jsxClosingElement(j.jsxIdentifier(wrapperName)),
              [j.jsxText(cleanedValue)]
            );
          }
        }
        return child;
      })
      .filter(child => child.type !== 'JSXText' || child.value.trim() !== '');
  }

  // Helper to convert Tailwind classes
  function convertTailwindClasses(classNameValue) {
    if (classNameValue.type === 'StringLiteral' || classNameValue.type === 'Literal') {
      let classes = classNameValue.value.split(' ').filter(Boolean);
      classes = classes
        .map(cls => {
          if (cls === 'inline-flex') {
            return ['flex', 'flex-row'];
          }
          if (cls.match(/^(hover|focus|active|visited|disabled|first|last|odd|even):/)) {
            return `web:${cls}`;
          }
          if (cls.includes('scrollbar')) return '';
          if (cls === 'aspect-ratio') return null;
          return cls;
        })
        .filter(Boolean);

      // Add flex-row if flex is present and neither flex-row nor flex-col exists
      if (classes.includes('flex') && !classes.includes('row') && !classes.includes('col')) {
        classes.push('flex-row');
      }

      classes = classes.filter(Boolean).join(' ');
      return classes ? j.literal(classes) : null;
    }
    return classNameValue;
  }

  // Helper to merge or update className attributes
  function updateClassNameAttributes(attributes, newClassName) {
    if (!attributes) return [j.jsxAttribute(j.jsxIdentifier('className'), j.literal(newClassName))];
    const classNameAttr = attributes.find(attr => attr.name && attr.name.name === 'className');
    if (classNameAttr) {
      const existingClasses = classNameAttr.value.type === 'StringLiteral' ? classNameAttr.value.value : '';
      classNameAttr.value = j.literal(existingClasses ? `${existingClasses} ${newClassName}`.trim() : newClassName);
    } else {
      attributes.push(j.jsxAttribute(j.jsxIdentifier('className'), j.literal(newClassName)));
    }
    return attributes;
  }

  // Convert className attributes across all JSX elements
  root.find(j.JSXAttribute, { name: { name: 'className' } }).forEach(path => {
    const newValue = convertTailwindClasses(path.node.value);
    if (newValue) {
      path.node.value = newValue;
    } else {
      j(path).remove();
    }
  });

  // Wrap text nodes in <Text> except in ButtonText, Input, Text, or Heading
  root.find(j.JSXElement).forEach(path => {
    const { openingElement } = path.node;
    if (!openingElement || !openingElement.name || openingElement.name.type !== 'JSXIdentifier') return;
    const parentName = openingElement.name.name;
    if (['ButtonText', 'Input', 'Text', 'Heading'].includes(parentName)) return;
    if (!path.node.children) path.node.children = [];
    path.node.children = wrapTextChildren(path.node.children, 'Text', parentName);
  });

  // Convert HTML elements to gluestack equivalents and handle onClick
  root.find(j.JSXElement).forEach(path => {
    const { openingElement, closingElement } = path.node;
    if (!openingElement || !openingElement.name || openingElement.name.type !== 'JSXIdentifier') return;
    const tagName = openingElement.name.name;
    let newTagName = null;
    let wrapInPressable = false;
    let isButton = false;

    // Initialize attributes if undefined
    if (!openingElement.attributes) openingElement.attributes = [];

    // Check for onClick attribute
    const onClickAttr = openingElement.attributes.find(attr => attr.name && attr.name.name === 'onClick');
    const hasOnClick = !!onClickAttr;

    switch (tagName) {
      case 'div':
      case 'nav':
        newTagName = 'Box';
        wrapInPressable = hasOnClick;
        break;
      case 'button':
        newTagName = 'Button';
        isButton = true;
        if (!path.node.children) path.node.children = [];
        path.node.children = wrapTextChildren(path.node.children, 'ButtonText', tagName).map(child => {
          if (
            child.type === 'JSXElement' &&
            child.openingElement.name.type === 'JSXIdentifier' &&
            child.openingElement.name.name.match(/^[A-Z]/)
          ) {
            return j.jsxElement(
              j.jsxOpeningElement(j.jsxIdentifier('ButtonIcon'), [
                j.jsxAttribute(j.jsxIdentifier('as'), j.jsxExpressionContainer(j.jsxIdentifier(child.openingElement.name.name))),
              ]),
              j.jsxClosingElement(j.jsxIdentifier('ButtonIcon')),
              []
            );
          }
          return child;
        });
        break;
      case 'input':
        newTagName = 'Input';
        const inputFieldPropsNames = ['placeholder', 'name', 'value', 'onChangeText', 'secureTextEntry', 'keyboardType'];
        const inputProps = openingElement.attributes.filter(attr => attr.name && !inputFieldPropsNames.includes(attr.name.name));
        const inputFieldProps = openingElement.attributes.filter(attr => attr.name && inputFieldPropsNames.includes(attr.name.name));
        const inputField = j.jsxElement(
          j.jsxOpeningElement(j.jsxIdentifier('InputField'), inputFieldProps),
          j.jsxClosingElement(j.jsxIdentifier('InputField')),
          []
        );
        openingElement.attributes = inputProps;
        path.node.children = [inputField];
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
        newTagName = 'Heading';
        openingElement.attributes = updateClassNameAttributes(openingElement.attributes, 'text-2xl font-bold');
        // Avoid wrapping children in Text for Heading
        path.node.children = path.node.children || [];
        break;
      case 'p':
      case 'span':
        newTagName = 'Text';
        path.node.children = wrapTextChildren(path.node.children, 'Text', tagName);
        break;
    }

    if (newTagName) {
      openingElement.name = j.jsxIdentifier(newTagName);
      if (closingElement && closingElement.name && closingElement.name.type === 'JSXIdentifier') {
        closingElement.name = j.jsxIdentifier(newTagName);
      }

      // Handle onClick to onPress
      if (hasOnClick) {
        if (isButton) {
          onClickAttr.name.name = 'onPress';
        } else if (wrapInPressable) {
          const pressableElement = j.jsxElement(
            j.jsxOpeningElement(j.jsxIdentifier('Pressable'), [
              j.jsxAttribute(j.jsxIdentifier('onPress'), onClickAttr.value),
            ]),
            j.jsxClosingElement(j.jsxIdentifier('Pressable')),
            [path.node]
          );
          openingElement.attributes = openingElement.attributes.filter(attr => attr.name && attr.name.name !== 'onClick');
          j(path).replaceWith(pressableElement);
        }
      }
    }
  });

  // Button: Wrap text in <ButtonText>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Button' } } }).forEach(path => {
    if (!path.node.children) path.node.children = [];
    path.node.children = wrapTextChildren(path.node.children, 'ButtonText', 'Button');
  });

  // Input: Move specific props to <InputField>
  const inputFieldPropsNames = ['placeholder', 'name', 'value', 'onChangeText', 'secureTextEntry', 'keyboardType'];
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Input' } } }).forEach(path => {
    const openingElement = path.node.openingElement;
    if (!openingElement.attributes) openingElement.attributes = [];
    const inputProps = openingElement.attributes.filter(attr => attr.name && !inputFieldPropsNames.includes(attr.name.name));
    const inputFieldProps = openingElement.attributes.filter(attr => attr.name && inputFieldPropsNames.includes(attr.name.name));
    const inputField = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('InputField'), inputFieldProps),
      j.jsxClosingElement(j.jsxIdentifier('InputField')),
      []
    );
    path.node.openingElement.attributes = inputProps;
    path.node.children = [inputField];
  });

  // Select: Transform to <Select> with <SelectTrigger>, <SelectInput>, <SelectContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Select' } } }).forEach(path => {
    const selectTrigger = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('SelectTrigger')),
      j.jsxClosingElement(j.jsxIdentifier('SelectTrigger')),
      [
        j.jsxElement(
          j.jsxOpeningElement(j.jsxIdentifier('SelectInput')),
          j.jsxClosingElement(j.jsxIdentifier('SelectInput')),
          []
        ),
      ]
    );
    const selectContent = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('SelectContent')),
      j.jsxClosingElement(j.jsxIdentifier('SelectContent')),
      path.node.children || []
    );
    path.node.children = [selectTrigger, selectContent];
  });

  // Dialog (maps to AlertDialog): Add <AlertDialogBackdrop> and wrap children in <AlertDialogContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Dialog' } } }).forEach(path => {
    const alertDialogBackdrop = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('AlertDialogBackdrop')),
      j.jsxClosingElement(j.jsxIdentifier('AlertDialogBackdrop')),
      []
    );
    const alertDialogContent = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('AlertDialogContent')),
      j.jsxClosingElement(j.jsxIdentifier('AlertDialogContent')),
      path.node.children || []
    );
    path.node.openingElement.name = j.jsxIdentifier('AlertDialog');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('AlertDialog');
    }
    path.node.children = [alertDialogBackdrop, alertDialogContent];
  });

  // Modal: Add <ModalBackdrop> and wrap children in <ModalContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Modal' } } }).forEach(path => {
    const modalBackdrop = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('ModalBackdrop')),
      j.jsxClosingElement(j.jsxIdentifier('ModalBackdrop')),
      []
    );
    const modalContent = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('ModalContent')),
      j.jsxClosingElement(j.jsxIdentifier('ModalContent')),
      path.node.children || []
    );
    path.node.openingElement.name = j.jsxIdentifier('Modal');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('Modal');
    }
    path.node.children = [modalBackdrop, modalContent];
  });

  // Card: Replace with <Box>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Card' } } }).forEach(path => {
    path.node.openingElement.name = j.jsxIdentifier('Box');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('Box');
    }
  });

  // Alert: Wrap text in <AlertText>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Alert' } } }).forEach(path => {
    if (!path.node.children) path.node.children = [];
    path.node.children = wrapTextChildren(path.node.children, 'AlertText', 'Alert');
  });

  // Badge: Wrap text in <BadgeText>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Badge' } } }).forEach(path => {
    if (!path.node.children) path.node.children = [];
    path.node.children = wrapTextChildren(path.node.children, 'BadgeText', 'Badge');
  });

  // Checkbox: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Checkbox' } } });

  // RadioGroup: Replace with <RadioGroup>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'RadioGroup' } } }).forEach(path => {
    path.node.openingElement.name = j.jsxIdentifier('RadioGroup');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('RadioGroup');
    }
  });

  // Switch: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Switch' } } });

  // Tabs: Transform to <Tabs> with <TabsTabList> and <TabsTabPanels>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Tabs' } } }).forEach(path => {
    const tabList = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('TabsTabList')),
      j.jsxClosingElement(j.jsxIdentifier('TabsTabList')),
      (path.node.children || []).filter(
        child => child.type === 'JSXElement' && child.openingElement.name.type === 'JSXIdentifier' && child.openingElement.name.name === 'Tab'
      )
    );
    const tabPanels = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('TabsTabPanels')),
      j.jsxClosingElement(j.jsxIdentifier('TabsTabPanels')),
      (path.node.children || []).filter(
        child => child.type === 'JSXElement' && child.openingElement.name.type === 'JSXIdentifier' && child.openingElement.name.name === 'TabPanel'
      )
    );
    path.node.children = [tabList, tabPanels];
  });

  // Tooltip: Wrap children in <TooltipContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Tooltip' } } }).forEach(path => {
    const tooltipContent = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('TooltipContent')),
      j.jsxClosingElement(j.jsxIdentifier('TooltipContent')),
      path.node.children || []
    );
    path.node.children = [tooltipContent];
  });

  // Accordion: Transform to <Accordion> with <AccordionItem>, <AccordionTrigger>, <AccordionContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Accordion' } } }).forEach(path => {
    const accordionItems = (path.node.children || []).map(child => {
      if (child.type === 'JSXElement' && child.openingElement.name.type === 'JSXIdentifier') {
        const trigger = child.children.find(
          c => c.type === 'JSXElement' && c.openingElement.name.type === 'JSXIdentifier' && c.openingElement.name.name === 'AccordionHeader'
        );
        const content = child.children.find(
          c => c.type === 'JSXElement' && c.openingElement.name.type === 'JSXIdentifier' && c.openingElement.name.name === 'AccordionContent'
        );
        return j.jsxElement(
          j.jsxOpeningElement(j.jsxIdentifier('AccordionItem')),
          j.jsxClosingElement(j.jsxIdentifier('AccordionItem')),
          [
            j.jsxElement(
              j.jsxOpeningElement(j.jsxIdentifier('AccordionTrigger')),
              j.jsxClosingElement(j.jsxIdentifier('AccordionTrigger')),
              trigger ? trigger.children : []
            ),
            content ||
              j.jsxElement(
                j.jsxOpeningElement(j.jsxIdentifier('AccordionContent')),
                j.jsxClosingElement(j.jsxIdentifier('AccordionContent')),
                []
              ),
          ]
        );
      }
      return child;
    });
    path.node.children = accordionItems;
  });

  // Avatar: Handle <AvatarImage> if present
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Avatar' } } }).forEach(path => {
    const imageChild = (path.node.children || []).find(
      child => child.type === 'JSXElement' && child.openingElement.name.type === 'JSXIdentifier' && child.openingElement.name.name === 'AvatarImage'
    );
    if (imageChild) {
      path.node.children = [imageChild];
    }
  });

  // Progress: Add <ProgressFilledTrack>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Progress' } } }).forEach(path => {
    const progressFilled = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('ProgressFilledTrack')),
      j.jsxClosingElement(j.jsxIdentifier('ProgressFilledTrack')),
      []
    );
    path.node.children = [progressFilled];
  });

  // Form: Replace with <FormControl>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Form' } } }).forEach(path => {
    path.node.openingElement.name = j.jsxIdentifier('FormControl');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('FormControl');
    }
  });

  // Slider: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Slider' } } });

  // Separator: Replace with <Divider>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Separator' } } }).forEach(path => {
    path.node.openingElement.name = j.jsxIdentifier('Divider');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('Divider');
    }
  });

  // Skeleton: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Skeleton' } } });

  // Toast: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Toast' } } });

  // Textarea: Replace with <TextArea>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Textarea' } } }).forEach(path => {
    path.node.openingElement.name = j.jsxIdentifier('TextArea');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('TextArea');
    }
  });

  // Popover: Replace with <Actionsheet> and wrap in <ActionsheetContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Popover' } } }).forEach(path => {
    const actionsheetContent = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('ActionsheetContent')),
      j.jsxClosingElement(j.jsxIdentifier('ActionsheetContent')),
      path.node.children || []
    );
    path.node.openingElement.name = j.jsxIdentifier('Actionsheet');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('Actionsheet');
    }
    path.node.children = [actionsheetContent];
  });

  // DropdownMenu: Replace with <Menu>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'DropdownMenu' } } }).forEach(path => {
    path.node.openingElement.name = j.jsxIdentifier('Menu');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('Menu');
    }
  });

  // Sheet: Replace with <Actionsheet>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Sheet' } } }).forEach(path => {
    const actionsheetContent = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('ActionsheetContent')),
      j.jsxClosingElement(j.jsxIdentifier('ActionsheetContent')),
      path.node.children || []
    );
    path.node.openingElement.name = j.jsxIdentifier('Actionsheet');
    if (path.node.closingElement && path.node.closingElement.name) {
      path.node.closingElement.name = j.jsxIdentifier('Actionsheet');
    }
    path.node.children = [actionsheetContent];
  });

  // Fab: Wrap text in <FabLabel>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Fab' } } }).forEach(path => {
    if (!path.node.children) path.node.children = [];
    path.node.children = wrapTextChildren(path.node.children, 'FabLabel', 'Fab');
  });

  // Breadcrumb: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Breadcrumb' } } });

  // AvatarGroup: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'AvatarGroup' } } });

  // Kbd: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Kbd' } } });

  // Replace lucide-react with lucide-react-native
  root.find(j.ImportDeclaration, { source: { value: 'lucide-react' } }).forEach(path => {
    path.node.source.value = 'lucide-react-native';
  });

  // Add gluestack imports
  const gluestackImports = [
    { name: 'Box', module: '@/components/ui/box' },
    { name: 'Text', module: '@components/ui/text' },
    { name: 'Heading', module: '@components/ui/heading' },
    { name: 'Button', module: '@components/ui/button' },
    { name: 'ButtonText', module: '@components/ui/button' },
    { name: 'ButtonIcon', module: '@components/ui/button' },
    { name: 'Pressable', module: '@components/ui/pressable' },
    { name: 'Input', module: '@components/ui/input' },
    { name: 'InputField', module: '@components/ui/input' },
  ];

  gluestackImports.forEach(({ name, module }) => {
    const existingImport = root.find(j.ImportDeclaration, { source: { value: module } });
    if (existingImport.size() === 0) {
      const importDecl = j.importDeclaration([j.importSpecifier(j.identifier(name))], j.literal(module));
      root.find(j.Program).get('body', 0).insertBefore(importDecl);
    } else {
      existingImport.forEach(path => {
        const hasImport = path.node.specifiers.some(spec => spec.local && spec.local.name === name);
        if (!hasImport) {
          path.node.specifiers.push(j.importSpecifier(j.identifier(name)));
        }
      });
    }
  });

  // Remove react-native imports
  root.find(j.ImportDeclaration, { source: { value: 'react-native' } }).remove();

  // Preserve @/components/ui/* imports
  return root.toSource();
};
