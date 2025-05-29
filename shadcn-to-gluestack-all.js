const j = require('jscodeshift');

// Explicitly use TypeScript parser
module.exports.parser = 'tsx';

module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Helper to wrap text children in a specified component
  function wrapTextChildren(children, wrapperName) {
    return children.map(child => {
      if (child.type === 'JSXText' && child.value.trim() !== '') {
        return j.jsxElement(
          j.jsxOpeningElement(j.jsxIdentifier(wrapperName)),
          j.jsxClosingElement(j.jsxIdentifier(wrapperName)),
          [child]
        );
      }
      return child;
    }).filter(child => child.type !== 'JSXText' || child.value.trim() !== '');
  }

  // Helper to convert Tailwind classes
  function convertTailwindClasses(classNameValue) {
    if (classNameValue.type === 'StringLiteral' || classNameValue.type === 'Literal') {
      let classes = classNameValue.value.split(' ');
      classes = classes.map(cls => {
        if (cls.match(/^(hover|focus|active|visited|disabled|first|last|odd|even):/)) {
          return `web:${cls}`; // Prefix entire pseudo-class
        }
        if (cls.startsWith('grid')) return 'flex'; // Replace grid with flex
        if (cls.includes('scrollbar')) return ''; // Remove scrollbar classes
        if (cls === 'aspect-ratio') return ''; // Remove aspect-ratio
        return cls;
      }).filter(Boolean).join(' ');
      return classes ? j.literal(classes) : null;
    }
    return classNameValue; // Preserve dynamic classNames
  }

  // Merge multiple className attributes
  function mergeClassNames(attributes) {
    const classNameAttrs = attributes.filter(attr => attr.name && attr.name.name === 'className');
    if (classNameAttrs.length <= 1) return attributes;

    const mergedClasses = classNameAttrs
      .filter(attr => attr.value && (attr.value.type === 'StringLiteral' || attr.value.type === 'Literal'))
      .map(attr => attr.value.value)
      .join(' ');
    
    const otherAttrs = attributes.filter(attr => attr.name && attr.name.name !== 'className');
    if (mergedClasses) {
      otherAttrs.push(j.jsxAttribute(j.jsxIdentifier('className'), j.literal(mergedClasses)));
    }
    return otherAttrs;
  }

  // Convert className attributes across all JSX elements
  root.find(j.JSXAttribute, { name: { name: 'className' } })
    .forEach(path => {
      const newValue = convertTailwindClasses(path.node.value);
      if (newValue) {
        path.node.value = newValue;
      } else {
        j(path).remove(); // Remove empty className
      }
    });

  // Handle onClick to onPress and wrap non-buttons in Pressable
  root.find(j.JSXElement)
    .forEach(path => {
      const { openingElement, closingElement } = path.node;
      if (!openingElement || !openingElement.name || openingElement.name.type !== 'JSXIdentifier') return;
      const tagName = openingElement.name.name;

      const onClickAttr = openingElement.attributes.find(attr => attr.name && attr.name.name === 'onClick');
      if (!onClickAttr) return;

      if (tagName === 'button' || tagName === 'Button') {
        // For buttons, convert onClick to onPress
        onClickAttr.name.name = 'onPress';
      } else {
        // For non-buttons, wrap in Pressable and move onClick to onPress
        const pressableElement = j.jsxElement(
          j.jsxOpeningElement(
            j.jsxIdentifier('Pressable'),
            [
              j.jsxAttribute(j.jsxIdentifier('onPress'), onClickAttr.value),
              ...openingElement.attributes.filter(attr => attr.name && attr.name.name !== 'onClick')
            ]
          ),
          j.jsxClosingElement(j.jsxIdentifier('Pressable')),
          [path.node]
        );
        j(path).replaceWith(pressableElement);
      }
    });

  // Wrap text nodes in Text except in ButtonText or Input
  root.find(j.JSXElement)
    .forEach(path => {
      const { openingElement } = path.node;
      if (!openingElement || !openingElement.name || openingElement.name.type !== 'JSXIdentifier') return;
      const parentName = openingElement.name.name;
      if (parentName !== 'ButtonText' && parentName !== 'Input') {
        path.node.children = path.node.children.map(child => {
          if (child.type === 'JSXText' && child.value.trim() !== '') {
            return j.jsxElement(
              j.jsxOpeningElement(j.jsxIdentifier('Text')),
              j.jsxClosingElement(j.jsxIdentifier('Text')),
              [child]
            );
          }
          return child;
        }).filter(child => child.type !== 'JSXText' || child.value.trim() !== '');
      }
    });

  // Convert HTML elements to gluestack-ui equivalents
  root.find(j.JSXElement)
    .forEach(path => {
      const { openingElement, closingElement } = path.node;
      if (!openingElement || !openingElement.name || openingElement.name.type !== 'JSXIdentifier') return;
      const tagName = openingElement.name.name;
      let newTagName = null;

      switch (tagName) {
        case 'div':
          newTagName = 'Box';
          break;
        case 'button':
          newTagName = 'Button';
          openingElement.attributes = openingElement.attributes.map(attr => {
            if (attr.name && attr.name.name === 'onClick') {
              return j.jsxAttribute(j.jsxIdentifier('onPress'), attr.value);
            }
            return attr;
          });
          path.node.children = wrapTextChildren(path.node.children, 'Text');
          break;
        case 'h3':
          newTagName = 'Text';
          if (openingElement.attributes) {
            const existingClassName = openingElement.attributes.find(attr => attr.name && attr.name.name === 'className');
            const newClassName = existingClassName
              ? `${existingClassName.value.value} text-xl font-semibold`
              : 'text-xl font-semibold';
            openingElement.attributes = openingElement.attributes.filter(attr => attr.name && attr.name.name !== 'className');
            openingElement.attributes.push(
              j.jsxAttribute(j.jsxIdentifier('className'), j.literal(newClassName))
            );
            openingElement.attributes = mergeClassNames(openingElement.attributes);
          }
          break;
        case 'p':
        case 'span':
          newTagName = 'Text';
          break;
      }

      if (newTagName) {
        openingElement.name.name = newTagName;
        if (closingElement && closingElement.name && closingElement.name.type === 'JSXIdentifier') {
          closingElement.name.name = newTagName;
        }
      }
    });

  // Button: Wrap text children with <ButtonText>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Button' } } })
    .forEach(path => {
      path.node.children = wrapTextChildren(path.node.children, 'ButtonText');
    });

  // Input: Move specific props to <InputField>
  const inputFieldPropsNames = ['placeholder', 'value', 'onChangeText', 'secureTextEntry', 'keyboardType'];
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Input' } } })
    .forEach(path => {
      const openingElement = path.node.openingElement;
      const attributes = openingElement.attributes || [];
      const inputProps = attributes.filter(attr => attr.name && !inputFieldPropsNames.includes(attr.name.name));
      const inputFieldProps = attributes.filter(attr => attr.name && inputFieldPropsNames.includes(attr.name.name));
      const inputField = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('InputField'), inputFieldProps),
        j.jsxClosingElement(j.jsxIdentifier('InputField')),
        []
      );
      path.node.openingElement.attributes = inputProps;
      path.node.children = [inputField];
    });

  // Select: Transform to <Select> with <SelectTrigger>, <SelectInput>, <SelectContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Select' } } })
    .forEach(path => {
      const selectTrigger = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('SelectTrigger')),
        j.jsxClosingElement(j.jsxIdentifier('SelectTrigger')),
        [j.jsxElement(
          j.jsxOpeningElement(j.jsxIdentifier('SelectInput')),
          j.jsxClosingElement(j.jsxIdentifier('SelectInput')),
          []
        )]
      );
      const selectContent = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('SelectContent')),
        j.jsxClosingElement(j.jsxIdentifier('SelectContent')),
        path.node.children
      );
      path.node.children = [selectTrigger, selectContent];
    });

  // Dialog (maps to AlertDialog): Add <AlertDialogBackdrop> and wrap children in <AlertDialogContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Dialog' } } })
    .forEach(path => {
      const alertDialogBackdrop = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('AlertDialogBackdrop')),
        j.jsxClosingElement(j.jsxIdentifier('AlertDialogBackdrop')),
        []
      );
      const alertDialogContent = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('AlertDialogContent')),
        j.jsxClosingElement(j.jsxIdentifier('AlertDialogContent')),
        path.node.children
      );
      path.node.openingElement.name.name = 'AlertDialog';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'AlertDialog';
      }
      path.node.children = [alertDialogBackdrop, alertDialogContent];
    });

  // Modal: Add <ModalBackdrop> and wrap children in <ModalContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Modal' } } })
    .forEach(path => {
      const modalBackdrop = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('ModalBackdrop')),
        j.jsxClosingElement(j.jsxIdentifier('ModalBackdrop')),
        []
      );
      const modalContent = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('ModalContent')),
        j.jsxClosingElement(j.jsxIdentifier('ModalContent')),
        path.node.children
      );
      path.node.openingElement.name.name = 'Modal';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'Modal';
      }
      path.node.children = [modalBackdrop, modalContent];
    });

  // Card: Replace with <Box>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Card' } } })
    .forEach(path => {
      path.node.openingElement.name.name = 'Box';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'Box';
      }
    });

  // Alert: Wrap text in <AlertText>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Alert' } } })
    .forEach(path => {
      path.node.children = wrapTextChildren(path.node.children, 'AlertText');
    });

  // Badge: Wrap text in <BadgeText>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Badge' } } })
    .forEach(path => {
      path.node.children = wrapTextChildren(path.node.children, 'BadgeText');
    });

  // Checkbox: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Checkbox' } } });

  // RadioGroup: Replace with <RadioGroup>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'RadioGroup' } } })
    .forEach(path => {
      path.node.openingElement.name.name = 'RadioGroup';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'RadioGroup';
      }
    });

  // Switch: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Switch' } } });

  // Tabs: Transform to <Tabs> with <TabsTabList> and <TabsTabPanels>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Tabs' } } })
    .forEach(path => {
      const tabList = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('TabsTabList')),
        j.jsxClosingElement(j.jsxIdentifier('TabsTabList')),
        path.node.children.filter(child => child.openingElement?.name?.type === 'JSXIdentifier' && child.openingElement.name.name === 'Tab')
      );
      const tabPanels = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('TabsTabPanels')),
        j.jsxClosingElement(j.jsxIdentifier('TabsTabPanels')),
        path.node.children.filter(child => child.openingElement?.name?.type === 'JSXIdentifier' && child.openingElement.name.name === 'TabPanel')
      );
      path.node.children = [tabList, tabPanels];
    });

  // Tooltip: Wrap children in <TooltipContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Tooltip' } } })
    .forEach(path => {
      const tooltipContent = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('TooltipContent')),
        j.jsxClosingElement(j.jsxIdentifier('TooltipContent')),
        path.node.children
      );
      path.node.children = [tooltipContent];
    });

  // Accordion: Transform to <Accordion> with <AccordionItem>, <AccordionTrigger>, <AccordionContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Accordion' } } })
    .forEach(path => {
      const accordionItems = path.node.children.map(child => {
        if (child.type === 'JSXElement' && child.openingElement.name.type === 'JSXIdentifier') {
          const trigger = child.children.find(c => c.type === 'JSXElement' && c.openingElement.name.type === 'JSXIdentifier' && c.openingElement.name.name === 'AccordionHeader');
          const content = child.children.find(c => c.type === 'JSXElement' && c.openingElement.name.type === 'JSXIdentifier' && c.openingElement.name.name === 'AccordionContent');
          return j.jsxElement(
            j.jsxOpeningElement(j.jsxIdentifier('AccordionItem')),
            j.jsxClosingElement(j.jsxIdentifier('AccordionItem')),
            [
              j.jsxElement(
                j.jsxOpeningElement(j.jsxIdentifier('AccordionTrigger')),
                j.jsxClosingElement(j.jsxIdentifier('AccordionTrigger')),
                trigger ? trigger.children : []
              ),
              content || j.jsxElement(
                j.jsxOpeningElement(j.jsxIdentifier('AccordionContent')),
                j.jsxClosingElement(j.jsxIdentifier('AccordionContent')),
                []
              )
            ]
          );
        }
        return child;
      });
      path.node.children = accordionItems;
    });

  // Avatar: Handle <AvatarImage> if present
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Avatar' } } })
    .forEach(path => {
      const imageChild = path.node.children.find(child => child.type === 'JSXElement' && child.openingElement.name.type === 'JSXIdentifier' && child.openingElement.name.name === 'AvatarImage');
      if (imageChild) {
        path.node.children = [imageChild];
      }
    });

  // Progress: Add <ProgressFilledTrack>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Progress' } } })
    .forEach(path => {
      const progressFilled = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('ProgressFilledTrack')),
        j.jsxClosingElement(j.jsxIdentifier('ProgressFilledTrack')),
        []
      );
      path.node.children = [progressFilled];
    });

  // Form: Replace with <FormControl>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Form' } } })
    .forEach(path => {
      path.node.openingElement.name.name = 'FormControl';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'FormControl';
      }
    });

  // Slider: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Slider' } } });

  // Separator: Replace with <Divider>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Separator' } } })
    .forEach(path => {
      path.node.openingElement.name.name = 'Divider';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'Divider';
      }
    });

  // Skeleton: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Skeleton' } } });

  // Toast: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Toast' } } });

  // Textarea: Replace with <TextArea>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Textarea' } } })
    .forEach(path => {
      path.node.openingElement.name.name = 'TextArea';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'TextArea';
      }
    });

  // Popover: Replace with <Actionsheet> and wrap in <ActionsheetContent>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Popover' } } })
    .forEach(path => {
      const actionsheetContent = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('ActionsheetContent')),
        j.jsxClosingElement(j.jsxIdentifier('ActionsheetContent')),
        path.node.children
      );
      path.node.openingElement.name.name = 'Actionsheet';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'Actionsheet';
      }
      path.node.children = [actionsheetContent];
    });

  // DropdownMenu: Replace with <Menu>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'DropdownMenu' } } })
    .forEach(path => {
      path.node.openingElement.name.name = 'Menu';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'Menu';
      }
    });

  // Sheet: Replace with <Actionsheet>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Sheet' } } })
    .forEach(path => {
      const actionsheetContent = j.jsxElement(
        j.jsxOpeningElement(j.jsxIdentifier('ActionsheetContent')),
        j.jsxClosingElement(j.jsxIdentifier('ActionsheetContent')),
        path.node.children
      );
      path.node.openingElement.name.name = 'Actionsheet';
      if (path.node.closingElement && path.node.closingElement.name) {
        path.node.closingElement.name.name = 'Actionsheet';
      }
      path.node.children = [actionsheetContent];
    });

  // Fab: Wrap text in <FabLabel>
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Fab' } } })
    .forEach(path => {
      path.node.children = wrapTextChildren(path.node.children, 'FabLabel');
    });

  // Breadcrumb: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Breadcrumb' } } });

  // AvatarGroup: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'AvatarGroup' } } });

  // Kbd: Direct replacement
  root.find(j.JSXElement, { openingElement: { name: { type: 'JSXIdentifier', name: 'Kbd' } } });

  // Add gluestack-ui imports for Box, Text, Button, Pressable
  const gluestackImports = [
    { name: 'Box', path: '@/components/ui/box' },
    { name: 'Text', path: '@/components/ui/text' },
    { name: 'Button', path: '@/components/ui/button' },
    { name: 'Pressable', path: '@/components/ui/pressable' }
  ];

  gluestackImports.forEach(({ name, path }) => {
    const existingImport = root.find(j.ImportDeclaration, { source: { value: path } });
    if (existingImport.size() === 0) {
      const importDecl = j.importDeclaration(
        [j.importSpecifier(j.jsxIdentifier(name))],
        j.literal(path)
      );
      root.find(j.Program).get('body', 0).insertBefore(importDecl);
    } else {
      existingImport.forEach(p => {
        const hasImport = p.node.specifiers.some(spec => spec.local.name === name);
        if (!hasImport) {
          p.node.specifiers.push(j.importSpecifier(j.jsxIdentifier(name)));
        }
      });
    }
  });

  // Preserve @/components/ui/* imports
  return root.toSource();
};